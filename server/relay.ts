import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { TLSSocket } from 'node:tls';
import { WebSocketServer, WebSocket } from 'ws';
import { isHelloMessage, isPoseMessage, MAX_POSE_BYTES, MAX_POSES_PER_SECOND } from '../src/communication/protocol';

type Role = 'mobile' | 'viewer';
interface Room { tokens: Record<Role, string>; peers: Partial<Record<Role, WebSocket>>; touchedAt: number }
const hash = (token: string) => createHash('sha256').update(token).digest();
const sameToken = (left: string, right: string) => timingSafeEqual(hash(left), hash(right));
const send = (ws: WebSocket | undefined, payload: unknown) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload)); };
const isSecure = (request: IncomingMessage) => (request.socket as TLSSocket).encrypted === true;

export function attachRelay(servers: Server[]): void {
  const rooms = new Map<string, Room>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_POSE_BYTES });

  for (const server of servers) {
    server.prependListener('request', (request: IncomingMessage, response: ServerResponse) => {
      const url = new URL(request.url || '/', 'http://localhost');
      if (url.pathname !== '/api/rooms') return;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      const expectedOrigin = `${isSecure(request) ? 'https' : 'http'}://${request.headers.host}`;
      if (request.method !== 'POST') {
        response.writeHead(405, { Allow: 'POST' }).end(JSON.stringify({ error: 'Method not allowed' })); return;
      }
      if (request.headers.origin !== expectedOrigin) {
        response.writeHead(403).end(JSON.stringify({ error: 'Forbidden' })); return;
      }
      let roomId: string;
      do { roomId = [...randomBytes(8)].map(value => '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'[value % 32]).slice(0, 6).join(''); } while (rooms.has(roomId));
      const mobileToken = randomBytes(32).toString('base64url');
      const viewerToken = randomBytes(32).toString('base64url');
      rooms.set(roomId, { tokens: { mobile: mobileToken, viewer: viewerToken }, peers: {}, touchedAt: Date.now() });
      response.writeHead(201).end(JSON.stringify({ room: roomId, mobileToken, viewerToken }));
    });
    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url || '/', 'http://localhost');
      const expectedOrigin = `${isSecure(request) ? 'https' : 'http'}://${request.headers.host}`;
      if (url.pathname !== '/ws' || request.headers.origin !== expectedOrigin) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return;
      }
      wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
    });
  }

  wss.on('connection', ws => {
    let role: Role | undefined, room: Room | undefined, roomId: string | undefined, rateStart = Date.now(), rateCount = 0;
    const authTimer = setTimeout(() => ws.close(4001, 'hello timeout'), 5000);
    ws.on('message', (data, binary) => {
      const payload = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (binary || payload.byteLength > MAX_POSE_BYTES) { ws.close(1009, 'message too large'); return; }
      let message: unknown;
      try { message = JSON.parse(payload.toString()); } catch { ws.close(1007, 'invalid JSON'); return; }
      if (!role) {
        if (!isHelloMessage(message)) { ws.close(4002, 'invalid hello'); return; }
        room = rooms.get(message.room); role = message.role; roomId = message.room;
        if (!room || !sameToken(room.tokens[role], message.token)) { ws.close(4003, 'invalid credentials'); return; }
        if (room.peers[role]?.readyState === WebSocket.OPEN) { ws.close(4004, 'role already connected'); return; }
        clearTimeout(authTimer); room.peers[role] = ws; room.touchedAt = Date.now();
        send(ws, { type: 'ready' });
        const peer = room.peers[role === 'mobile' ? 'viewer' : 'mobile'];
        send(ws, { type: 'peer', connected: peer?.readyState === WebSocket.OPEN });
        if (peer) send(peer, { type: 'peer', connected: true });
        return;
      }
      if (role !== 'mobile' || !isPoseMessage(message, roomId)) { send(ws, { type: 'error', message: 'Invalid message or role' }); return; }
      const now = Date.now();
      if (now - rateStart >= 1000) { rateStart = now; rateCount = 0; }
      if (++rateCount > MAX_POSES_PER_SECOND) return;
      const viewer = room?.peers.viewer;
      if (viewer?.readyState === WebSocket.OPEN && viewer.bufferedAmount < MAX_POSE_BYTES * 2) send(viewer, message);
    });
    ws.on('close', () => {
      clearTimeout(authTimer);
      if (role && room && room.peers[role] === ws) {
        delete room.peers[role]; room.touchedAt = Date.now();
        send(room.peers[role === 'mobile' ? 'viewer' : 'mobile']!, { type: 'peer', connected: false });
      }
    });
    ws.on('error', () => ws.close());
  });
  const cleanup = setInterval(() => {
    for (const [id, room] of rooms) if (!room.peers.mobile && !room.peers.viewer && Date.now() - room.touchedAt > 30 * 60_000) rooms.delete(id);
  }, 60_000);
  cleanup.unref();
  for (const server of servers) server.on('close', () => { clearInterval(cleanup); wss.close(); });
}
