import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestCamera, stopStream, cameraError, cameraZoom, normalizeZoom, applyCameraZoom } from '../src/pose/camera';
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
  const pending = requestCamera(controller.signal, {}, (constraints) => {
    assert.equal(constraints.audio, false);
    return new Promise((done) => { resolve = done; });
  });
  controller.abort();
  resolve({ getTracks: () => [{ stop: () => stopped++ }, { stop: () => stopped++ }] } as unknown as MediaStream);
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(stopped, 2);
  let acquired = false;
  await assert.rejects(requestCamera(controller.signal, {}, async () => { acquired = true; throw new Error(); }));
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

test('rear camera defaults to HD and exact lens does not retain a conflicting facing constraint', async () => {
  const stream = { getTracks: () => [] } as unknown as MediaStream;
  const captures: MediaStreamConstraints[] = [];
  const acquire = async (constraints: MediaStreamConstraints) => { captures.push(constraints); return stream; };
  await requestCamera(new AbortController().signal, {}, acquire);
  await requestCamera(new AbortController().signal, { facing: 'user' }, acquire);
  await requestCamera(new AbortController().signal, { facing: 'environment', deviceId: 'telephoto' }, acquire);
  const defaults = captures[0]!.video as MediaTrackConstraints;
  assert.deepEqual(defaults.facingMode, { ideal: 'environment' });
  assert.deepEqual(defaults.width, { ideal: 1280 }); assert.deepEqual(defaults.height, { ideal: 720 });
  assert.equal(captures[0]!.audio, false);
  assert.deepEqual((captures[1]!.video as MediaTrackConstraints).facingMode, { ideal: 'user' });
  assert.deepEqual((captures[2]!.video as MediaTrackConstraints).deviceId, { exact: 'telephoto' });
  assert.equal((captures[2]!.video as MediaTrackConstraints).facingMode, undefined);
});
test('native zoom follows device ranges and reports actual applied values', async () => {
  let actual = 1;
  const track = {
    getCapabilities: () => ({ zoom: { min: 0.5, max: 4, step: 0.1 } }), getSettings: () => ({ zoom: actual }),
    applyConstraints: async (constraints: { advanced: { zoom: number }[] }) => { actual = constraints.advanced[0]!.zoom; },
  } as unknown as MediaStreamTrack;
  const range = cameraZoom(track)!;
  assert.deepEqual(range, { min: 0.5, max: 4, step: 0.1, value: 1 });
  assert.equal(normalizeZoom(9, range), 4); assert.equal(normalizeZoom(0, range), 0.5);
  assert.equal(normalizeZoom(1.26, range), 1.3); assert.equal(normalizeZoom(NaN, range), 1);
  assert.equal(await applyCameraZoom(track, 2.1), 2.1);
  assert.equal(cameraZoom({ getCapabilities: () => ({}) } as MediaStreamTrack), undefined);
  assert.equal(cameraZoom({ getCapabilities: () => ({ zoom: { min: 1, max: 3 } }), getSettings: () => ({}) } as unknown as MediaStreamTrack), undefined);
  assert.equal(cameraZoom({ getCapabilities: () => ({ zoom: { min: 1, max: 1 } }) } as unknown as MediaStreamTrack), undefined);
  assert.equal(cameraZoom({ getCapabilities: () => { throw new Error('unsupported'); } } as unknown as MediaStreamTrack), undefined);
  const denied = { applyConstraints: async () => { throw new DOMException('zoom unavailable', 'OverconstrainedError'); } } as unknown as MediaStreamTrack;
  await assert.rejects(applyCameraZoom(denied, 2), { name: 'OverconstrainedError' });
});
