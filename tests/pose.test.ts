import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestCamera, stopStream, cameraError } from '../src/pose/camera';
import { summarizePose, isVisible } from '../src/pose/poseTypes';
import { drawPose } from '../src/pose/drawPose';
test('empty and partially visible results preserve coordinate conventions', () => {
  assert.deepEqual(summarizePose({ normalizedLandmarks: [], worldLandmarks: [] }), { count: 0, visible: 0, status: '等待人体入镜' });
  const point = { x: 0.5, y: 0.2, z: -0.1, visibility: 0.9 };
  const frame = { normalizedLandmarks: [point, { ...point, visibility: 0.1 }, { ...point, x: NaN }], worldLandmarks: [{ ...point, x: 300 }] };
  assert.equal(summarizePose(frame).visible, 1);
  assert.equal(summarizePose(frame).count, 3);
  assert.equal(summarizePose(frame).status, '部分关键点不清晰');
  assert.equal(isVisible(undefined), false);
  assert.equal(summarizePose({ normalizedLandmarks: Array(33).fill(point), worldLandmarks: [] }).status, '已识别人体');
});
test('camera arriving after cancellation stops every track and cannot restart a stopped session', async () => {
  const controller = new AbortController(); let stopped = 0;
  let resolve!: (stream: MediaStream) => void;
  const pending = requestCamera(controller.signal, (constraints) => {
    assert.equal(constraints.audio, false);
    return new Promise((done) => { resolve = done; });
  });
  controller.abort();
  resolve({ getTracks: () => [{ stop: () => stopped++ }, { stop: () => stopped++ }] } as unknown as MediaStream);
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(stopped, 2);
  let acquired = false;
  await assert.rejects(requestCamera(controller.signal, async () => { acquired = true; throw new Error(); }));
  assert.equal(acquired, false);
});
test('camera stop and permission errors are actionable', () => {
  let stopped = 0; stopStream({ getTracks: () => [{ stop: () => stopped++ }] } as unknown as MediaStream);
  assert.equal(stopped, 1);
  assert.match(cameraError(new DOMException('denied', 'NotAllowedError')), /权限被拒绝/);
  assert.match(cameraError(new DOMException('busy', 'NotReadableError')), /占用/);
});
test('drawing clears stale skeleton, uses image coordinates and skips absent endpoints', () => {
  const calls: unknown[][] = [];
  const ctx = Object.fromEntries(['clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'arc', 'fill'].map((name) => [name, (...args: unknown[]) => calls.push([name, ...args])]));
  const canvas = { width: 100, height: 100, getContext: () => ctx } as unknown as HTMLCanvasElement;
  const point = { x: 0.2, y: 0.3, z: 0, visibility: 1 };
  drawPose(canvas, { normalizedLandmarks: [point, { ...point, x: 0.7 }, { ...point, visibility: 0 }], worldLandmarks: [{ ...point, x: 100 }] }, [{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 0, end: 99 }], 200, 100);
  assert.deepEqual(calls.find((call) => call[0] === 'moveTo'), ['moveTo', 40, 30]);
  assert.equal(calls.filter((call) => call[0] === 'lineTo').length, 1);
  calls.length = 0;
  drawPose(canvas, { normalizedLandmarks: [], worldLandmarks: [] }, [], 200, 100);
  assert.deepEqual(calls, [['clearRect', 0, 0, 200, 100]]);
});
