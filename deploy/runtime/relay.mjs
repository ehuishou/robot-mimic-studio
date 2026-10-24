// server/relay.ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

// src/communication/protocol.ts
var LANDMARK_COUNT = 33;
var MAX_POSE_BYTES = 8192;
var MAX_POSES_PER_SECOND = 20;
var MAX_COORDINATE = 10;
function isPoseMessage(value, room) {
  if (!value || typeof value !== "object") return false;
  const frame = value;
  return frame.type === "pose" && typeof frame.room === "string" && (!room || frame.room === room) && Number.isFinite(frame.timestamp) && Number.isSafeInteger(frame.seq) && frame.seq >= 0 && Array.isArray(frame.landmarks) && frame.landmarks.length === LANDMARK_COUNT && frame.landmarks.every((point) => !!point && [point.x, point.y, point.z, point.visibility].every(Number.isFinite) && Math.abs(point.x) <= MAX_COORDINATE && Math.abs(point.y) <= MAX_COORDINATE && Math.abs(point.z) <= MAX_COORDINATE && point.visibility >= 0 && point.visibility <= 1);
}
function isHelloMessage(value) {
  if (!value || typeof value !== "object") return false;
  const hello = value;
  return hello.type === "hello" && (hello.role === "mobile" || hello.role === "viewer") && typeof hello.room === "string" && /^[A-Z2-9]{6}$/.test(hello.room) && typeof hello.token === "string" && /^[A-Za-z0-9_-]{40,}$/.test(hello.token);
}

// server/relay.ts
var hash = (token) => createHash("sha256").update(token).digest();
var sameToken = (left, right) => timingSafeEqual(hash(left), hash(right));
var send = (ws, payload) => {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
};
var isSecure = (request) => request.socket.encrypted === true;
function attachRelay(servers) {
  const rooms = /* @__PURE__ */ new Map();
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_POSE_BYTES });
  for (const server of servers) {
    server.prependListener("request", (request, response) => {
      const url = new URL(request.url || "/", "http://localhost");
      if (url.pathname !== "/api/rooms") return;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      const expectedOrigin = `${isSecure(request) ? "https" : "http"}://${request.headers.host}`;
      if (request.method !== "POST") {
        response.writeHead(405, { Allow: "POST" }).end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }
      if (request.headers.origin !== expectedOrigin) {
        response.writeHead(403).end(JSON.stringify({ error: "Forbidden" }));
        return;
      }
      let roomId;
      do {
        roomId = [...randomBytes(8)].map((value) => "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"[value % 32]).slice(0, 6).join("");
      } while (rooms.has(roomId));
      const mobileToken = randomBytes(32).toString("base64url");
      const viewerToken = randomBytes(32).toString("base64url");
      rooms.set(roomId, { tokens: { mobile: mobileToken, viewer: viewerToken }, peers: {}, touchedAt: Date.now() });
      response.writeHead(201).end(JSON.stringify({ room: roomId, mobileToken, viewerToken }));
    });
    server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url || "/", "http://localhost");
      const expectedOrigin = `${isSecure(request) ? "https" : "http"}://${request.headers.host}`;
      if (url.pathname !== "/ws" || request.headers.origin !== expectedOrigin) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
    });
  }
  wss.on("connection", (ws) => {
    let role, room, roomId, rateStart = Date.now(), rateCount = 0;
    const authTimer = setTimeout(() => ws.close(4001, "hello timeout"), 5e3);
    ws.on("message", (data, binary) => {
      const payload = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (binary || payload.byteLength > MAX_POSE_BYTES) {
        ws.close(1009, "message too large");
        return;
      }
      let message;
      try {
        message = JSON.parse(payload.toString());
      } catch {
        ws.close(1007, "invalid JSON");
        return;
      }
      if (!role) {
        if (!isHelloMessage(message)) {
          ws.close(4002, "invalid hello");
          return;
        }
        room = rooms.get(message.room);
        role = message.role;
        roomId = message.room;
        if (!room || !sameToken(room.tokens[role], message.token)) {
          ws.close(4003, "invalid credentials");
          return;
        }
        if (room.peers[role]?.readyState === WebSocket.OPEN) {
          ws.close(4004, "role already connected");
          return;
        }
        clearTimeout(authTimer);
        room.peers[role] = ws;
        room.touchedAt = Date.now();
        send(ws, { type: "ready" });
        const peer = room.peers[role === "mobile" ? "viewer" : "mobile"];
        send(ws, { type: "peer", connected: peer?.readyState === WebSocket.OPEN });
        if (peer) send(peer, { type: "peer", connected: true });
        return;
      }
      if (role !== "mobile" || !isPoseMessage(message, roomId)) {
        send(ws, { type: "error", message: "Invalid message or role" });
        return;
      }
      const now = Date.now();
      if (now - rateStart >= 1e3) {
        rateStart = now;
        rateCount = 0;
      }
      if (++rateCount > MAX_POSES_PER_SECOND) return;
      const viewer = room?.peers.viewer;
      if (viewer?.readyState === WebSocket.OPEN && viewer.bufferedAmount < MAX_POSE_BYTES * 2) send(viewer, message);
    });
    ws.on("close", () => {
      clearTimeout(authTimer);
      if (role && room && room.peers[role] === ws) {
        delete room.peers[role];
        room.touchedAt = Date.now();
        send(room.peers[role === "mobile" ? "viewer" : "mobile"], { type: "peer", connected: false });
      }
    });
    ws.on("error", () => ws.close());
  });
  const cleanup = setInterval(() => {
    for (const [id, room] of rooms) if (!room.peers.mobile && !room.peers.viewer && Date.now() - room.touchedAt > 30 * 6e4) rooms.delete(id);
  }, 6e4);
  cleanup.unref();
  for (const server of servers) server.on("close", () => {
    clearInterval(cleanup);
    wss.close();
  });
}
export {
  attachRelay
};
