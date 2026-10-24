import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPoseMessage, normalizePoseLandmarks, PROTOCOL_VERSION } from '../src/communication/protocol';

const room = 'ABC234';
const sessionId = '0123456789abcdef';
const mediaPipeLandmarks = () => Array.from({ length: 33 }, (_, index) => ({
  x: index / 100,
  y: -index / 100,
  z: 0.1,
  visibility: 0.9,
  presence: 0.8,
}));

test('normalizes MediaPipe world landmarks to strict relay fields', () => {
  const landmarks = normalizePoseLandmarks(mediaPipeLandmarks());
  assert.ok(landmarks);
  assert.equal(landmarks.length, 33);
  assert.deepEqual(Object.keys(landmarks[0]!), ['x', 'y', 'z', 'visibility']);
  assert.equal(isPoseMessage({
    type: 'pose', version: PROTOCOL_VERSION, room, sessionId, timestamp: 10, seq: 1, landmarks,
  }, room), true);
});

test('skips missing or malformed detections instead of constructing a relay frame', () => {
  assert.equal(normalizePoseLandmarks([]), undefined);
  assert.equal(normalizePoseLandmarks(mediaPipeLandmarks().slice(0, 32)), undefined);
  const missingVisibility = mediaPipeLandmarks();
  delete (missingVisibility[0] as { visibility?: number }).visibility;
  const normalizedMissing = normalizePoseLandmarks(missingVisibility);
  assert.ok(normalizedMissing);
  assert.equal(normalizedMissing[0]!.visibility, 0);
  const invalidCoordinate = mediaPipeLandmarks();
  invalidCoordinate[12]!.x = Number.NaN;
  assert.equal(normalizePoseLandmarks(invalidCoordinate), undefined);
  const outOfRange = mediaPipeLandmarks();
  outOfRange[20]!.z = 11;
  assert.equal(normalizePoseLandmarks(outOfRange), undefined);
});