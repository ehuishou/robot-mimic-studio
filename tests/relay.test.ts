import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';
import { attachRelay } from '../server/relay';

const server = createServer((_request, response) => {
  if (!response.writableEnded) response.writeHead(404).end();
});
attachRelay([server]);
let origin = '';

before(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  server.close();
  server.closeAllConnections();
  await once(server, 'close');
});

async function createRoom() {
  const response = await fetch(`${origin}/api/rooms`, { method: 'POST', headers: { Origin: origin } });
  assert.equal(response.status, 201);
  return await response.json() as { room: string; mobileToken: string; viewerToken: string };
}

function connect(role: 'mobile' | 'viewer', room: string, token: string, requestOrigin = origin) {
  const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/ws`, { headers: { Origin: requestOrigin } });
  const queue: unknown[] = [];
  const waiters: Array<(value: any) => void> = [];
  const close = new Promise<number>(resolve => socket.once('close', code => resolve(code)));
  let fail!: (error: Error) => void;
  const error = new Promise<Error>(resolve => { fail = resolve; });
  socket.on('error', fail);
  (socket as any).__messages = { queue, waiters, close, error };
  socket.on('message', data => {
    const value = JSON.parse(data.toString());
    const waiter = waiters.shift();
    if (waiter) waiter(value);
    else queue.push(value);
  });
  socket.once('open', () => socket.send(JSON.stringify({ type: 'hello', role, room, token })));
  return socket;
}

function nextMessage(socket: WebSocket): Promise<any> {
  const messages = (socket as any).__messages;
  if (messages.queue.length) return Promise.resolve(messages.queue.shift());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for WebSocket message')), 2000);
    messages.waiters.push((value: unknown) => { clearTimeout(timer); resolve(value); });
  });
}

async function nextMessageOf(socket: WebSocket, type: string): Promise<any> {
  let message;
  do { message = await nextMessage(socket); } while (message.type !== type);
  return message;
}

function pose(room: string, seq = 1, count = 33) {
  return { type: 'pose', room, timestamp: 1, seq, landmarks: Array.from({ length: count }, () => ({ x: 0, y: 0, z: 0, visibility: 1 })) };
}

test('creates a room only for same-origin POST requests', async () => {
  const missingOrigin = await fetch(`${origin}/api/rooms`, { method: 'POST' });
  assert.equal(missingOrigin.status, 403);
  const crossOrigin = await fetch(`${origin}/api/rooms`, { method: 'POST', headers: { Origin: 'https://attacker.invalid' } });
  assert.equal(crossOrigin.status, 403);
  const room = await createRoom();
  assert.match(room.room, /^[A-Z2-9]{6}$/);
  assert.ok(room.mobileToken.length >= 40);
});

test('authenticates peers and relays poses only inside the room', async t => {
  const first = await createRoom(), second = await createRoom();
  const mobile = connect('mobile', first.room, first.mobileToken);
  const viewer = connect('viewer', first.room, first.viewerToken);
  const otherViewer = connect('viewer', second.room, second.viewerToken);
  t.after(() => { mobile.close(); viewer.close(); otherViewer.close(); });
  assert.equal((await nextMessage(mobile)).type, 'ready');
  assert.equal((await nextMessage(viewer)).type, 'ready');
  assert.equal((await nextMessage(otherViewer)).type, 'ready');
  const received = nextMessageOf(viewer, 'pose');
  mobile.send(JSON.stringify(pose(first.room)));
  assert.deepEqual(await received, pose(first.room));
  const unrelated = Promise.race([nextMessageOf(otherViewer, 'pose').then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 100))]);
  assert.equal(await unrelated, false);
});

test('rejects invalid credentials, duplicate roles and malformed poses', async t => {
  const room = await createRoom();
  const invalid = connect('mobile', room.room, 'A'.repeat(40));
  t.after(() => invalid.close());
  const code = await (invalid as any).__messages.close;
  assert.equal(code, 4003);

  const mobile = connect('mobile', room.room, room.mobileToken);
  const viewer = connect('viewer', room.room, room.viewerToken);
  t.after(() => { mobile.close(); viewer.close(); });
  await nextMessage(mobile);
  await nextMessage(viewer);
  const duplicate = connect('mobile', room.room, room.mobileToken);
  t.after(() => duplicate.close());
  const duplicateCode = await (duplicate as any).__messages.close;
  assert.equal(duplicateCode, 4004);

  const error = nextMessageOf(viewer, 'error');
  viewer.send(JSON.stringify(pose(room.room)));
  assert.equal((await error).type, 'error');
  const invalidPose = nextMessageOf(mobile, 'error');
  mobile.send(JSON.stringify(pose(room.room, 2, 32)));
  assert.equal((await invalidPose).type, 'error');
});

test('rejects WebSocket upgrades from a different origin', async () => {
  const socket = connect('viewer', 'ABC234', 'x'.repeat(40), 'https://attacker.invalid');
  const error = await (socket as any).__messages.error as Error;
  assert.match(error.message, /403/);
});
