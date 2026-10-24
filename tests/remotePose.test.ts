import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RemotePoseBuffer } from '../src/communication/remotePose';
import { PROTOCOL_VERSION, type PoseMessage } from '../src/communication/protocol';

const room = 'ABC234';
const firstSession = '0123456789abcdef';
const secondSession = 'fedcba9876543210';

function pose(sessionId: string, seq: number, timestamp: number): PoseMessage {
  return {
    type: 'pose' as const,
    version: PROTOCOL_VERSION,
    room,
    sessionId,
    seq,
    timestamp,
    landmarks: Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 })),
  };
}

test('accepts only the active session and consumes the newest accepted pose once', () => {
  const buffer = new RemotePoseBuffer();
  buffer.start(firstSession);

  assert.equal(buffer.push(pose(secondSession, 1, 1), 10), false);
  assert.equal(buffer.push(pose(firstSession, 1, 1), 20), true);
  assert.equal(buffer.push(pose(firstSession, 2, 2), 30), true);

  const accepted = buffer.take();
  assert.equal(accepted?.timestampMs, 30);
  assert.equal(accepted?.seq, 2);
  assert.equal(accepted?.landmarks.length, 33);
  assert.equal(buffer.take(), undefined);
});

test('rejects repeated or out-of-order sequence numbers and timestamps', () => {
  const buffer = new RemotePoseBuffer();
  buffer.start(firstSession);

  assert.equal(buffer.push(pose(firstSession, 2, 200), 1), true);
  assert.equal(buffer.push(pose(firstSession, 2, 201), 2), false);
  assert.equal(buffer.push(pose(firstSession, 3, 200), 3), false);
  assert.equal(buffer.push(pose(firstSession, 1, 199), 4), false);
  assert.equal(buffer.take()?.timestampMs, 1);
});

test('a new capture session resets ordering and stale frames cannot stop it', () => {
  const buffer = new RemotePoseBuffer();
  buffer.start(firstSession);
  assert.equal(buffer.push(pose(firstSession, 8, 800), 1), true);

  buffer.start(secondSession);
  assert.equal(buffer.take(), undefined);
  assert.equal(buffer.stop(firstSession), false);
  assert.equal(buffer.push(pose(firstSession, 9, 900), 2), false);
  assert.equal(buffer.push(pose(secondSession, 0, 0), 3), true);
  assert.equal(buffer.take()?.seq, 2);
});

test('stop and clear discard buffered data and deactivate the session', () => {
  const buffer = new RemotePoseBuffer();
  buffer.start(firstSession);
  buffer.push(pose(firstSession, 1, 1), 10);

  assert.equal(buffer.stop(firstSession), true);
  assert.equal(buffer.take(), undefined);
  assert.equal(buffer.push(pose(firstSession, 2, 2), 20), false);

  buffer.start(secondSession);
  buffer.push(pose(secondSession, 1, 1), 30);
  buffer.clear();
  assert.equal(buffer.take(), undefined);
  assert.equal(buffer.push(pose(secondSession, 2, 2), 40), false);
});


test('viewer pause/reset discard pending frames but preserve session and ordering for resume', () => {
  const buffer = new RemotePoseBuffer();
  buffer.start(firstSession);
  buffer.push(pose(firstSession, 5, 500), 10);
  buffer.discardPending();
  assert.equal(buffer.take(), undefined);
  assert.equal(buffer.push(pose(firstSession, 4, 400), 20), false);
  assert.equal(buffer.push(pose(firstSession, 6, 600), 30), true);
  assert.equal(buffer.take()?.timestampMs, 30);
  assert.equal(buffer.push(pose(secondSession, 7, 700), 40), false);
});
