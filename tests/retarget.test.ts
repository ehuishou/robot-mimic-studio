import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { collectBones } from '../src/robot/bones';
import { createFallbackRobot } from '../src/robot/fallback';
import { disposeObject } from '../src/robot/model';
import { Retargeter } from '../src/retarget/Retargeter';
import { fallbackMapping, objectPath } from '../src/retarget/rigMapping';
import { simulatedPose } from '../src/retarget/simulatedPose';
import type { Simulation } from '../src/retarget/simulatedPose';
import { parseRigConfig } from '../src/retarget/loadRigConfig';
import { toRetargetFrame } from '../src/retarget/poseAdapter';

function setup() {
  const root = createFallbackRobot(), bones = collectBones(root), configs = fallbackMapping(root, bones);
  const retargeter = new Retargeter(root, bones, configs);
  const arm = (side: 'Left' | 'Right') => bones.find(e => e.name === `${side}UpperArm`)!;
  return { root, bones, configs, retargeter, arm, close: () => { retargeter.dispose(); disposeObject(root); } };
}
function drive(r: Retargeter, mode: Simulation, start = 0, steps = 120, hz = 60) {
  for (let i = 1; i <= steps; i++) { const now = start + i * 1000 / hz; r.accept(simulatedPose(mode, now, Math.round(now * 1000)), now); r.update(now, 1 / hz); }
}
const near = (a: THREE.Quaternion, b: THREE.Quaternion, tolerance = 1e-5) => assert.ok(a.angleTo(b) < tolerance, `${a.angleTo(b)} >= ${tolerance}`);

test('left and right world input drive independent anatomical arms, with no selfie swap', () => {
  for (const mode of ['left', 'right'] as const) {
    const s = setup(); drive(s.retargeter, mode);
    const moved = s.arm(mode === 'left' ? 'Left' : 'Right'), rest = s.arm(mode === 'left' ? 'Right' : 'Left');
    assert.ok(moved.bone.quaternion.angleTo(moved.initialQuaternion) > 1);
    near(rest.bone.quaternion, rest.initialQuaternion);
    const endpoint = moved.bone.children.find(c => c instanceof THREE.Bone)!;
    const actual = endpoint.position.clone().normalize().applyQuaternion(moved.bone.getWorldQuaternion(new THREE.Quaternion()));
    assert.ok(actual.distanceTo(new THREE.Vector3(mode === 'left' ? 1 : -1, 0, 0)) < 1e-4);
    s.close();
  }
});

test('non-identity rest and rotating parent are correctly handled in parent space', () => {
  const root = new THREE.Group(), parent = new THREE.Bone(), bone = new THREE.Bone(), end = new THREE.Bone();
  root.rotation.y = -0.6; root.scale.setScalar(1.7); parent.rotation.set(0.4, -0.7, 0.5);
  bone.name = 'actual shoulder'; end.name = 'actual elbow'; bone.rotation.set(0.3, 0.1, -0.2);
  end.position.set(0.1, -0.4, 0.03); root.add(parent); parent.add(bone); bone.add(end);
  const bones = collectBones(root);
  const r = new Retargeter(root, bones, [{ side: 'left', segment: 'upperArm', sourceStart: [11], sourceEnd: [13], bonePath: objectPath(root, bone)!, endPath: objectPath(root, end)!, expectedBoneName: bone.name,
    expectedEndName: end.name, maxSwingRadians: Math.PI, axisCorrection: [0, 0, 0, 1] }]);
  drive(r, 'left');
  let actual = end.position.clone().normalize().applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()));
  assert.ok(actual.distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-4);
  parent.rotation.set(-0.2, 0.9, -0.6); drive(r, 'left', 2000);
  actual = end.position.clone().normalize().applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()));
  assert.ok(actual.distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-4);
  r.reset(); near(bone.quaternion, bones.find(e => e.bone === bone)!.initialQuaternion);
  r.dispose();
});

test('short confidence loss holds, sustained loss returns exactly to rest, per arm', () => {
  const s = setup(); drive(s.retargeter, 'both');
  const before = s.arm('Left').bone.quaternion.clone();
  s.retargeter.accept(simulatedPose('loss', 2050, 2050000), 2050); s.retargeter.update(2050, 0.05);
  near(s.arm('Left').bone.quaternion, before);
  drive(s.retargeter, 'loss', 2050, 180);
  near(s.arm('Left').bone.quaternion, s.arm('Left').initialQuaternion);
  assert.ok(s.arm('Right').bone.quaternion.toArray().every(Number.isFinite));
  s.close();
});

test('empty, zero-length and nonfinite observations cannot create NaN; stale renders recover', () => {
  for (const mode of ['missing', 'invalid'] as const) {
    const s = setup(); drive(s.retargeter, 'left'); drive(s.retargeter, mode, 2000, 180);
    near(s.arm('Left').bone.quaternion, s.arm('Left').initialQuaternion);
    assert.ok(s.retargeter.debug().every(d => d.actual.every(Number.isFinite))); s.close();
  }
  const s = setup(); drive(s.retargeter, 'left');
  const baseFrame = simulatedPose('neutral', 2050, 2050000);
  const frame = { ...baseFrame, worldLandmarks: [...baseFrame.worldLandmarks] };
  frame.worldLandmarks[13] = { ...frame.worldLandmarks[11] };
  s.retargeter.accept(frame, 2050);
  for (let i = 1; i <= 240; i++) s.retargeter.update(2050 + i * 1000 / 60, 1 / 60);
  near(s.arm('Left').bone.quaternion, s.arm('Left').initialQuaternion); s.close();
});

test('sequence/timestamp validation rejects repeated, out of order, future and old frames', () => {
  const s = setup();
  assert.ok(s.retargeter.accept(simulatedPose('left', 100, 1), 100));
  assert.equal(s.retargeter.accept(simulatedPose('right', 110, 1), 110), false);
  assert.equal(s.retargeter.accept(simulatedPose('right', 90, 2), 110), false);
  assert.equal(s.retargeter.accept(simulatedPose('right', NaN, 2), 110), false);
  assert.equal(s.retargeter.accept(simulatedPose('right', 500, 2), 110), false);
  assert.equal(s.retargeter.accept(simulatedPose('right', 200, 2), 2000), false);
  s.retargeter.clearInput(); assert.ok(s.retargeter.accept(simulatedPose('right', 300, 0), 300));
  s.close();
});

test('swing limit bounds reversed input and deterministic twist has no quaternion explosions', () => {
  const s = setup(); drive(s.retargeter, 'antipode');
  const left = s.arm('Left');
  assert.ok(left.bone.quaternion.angleTo(left.initialQuaternion) <= THREE.MathUtils.degToRad(160) + 1e-6);
  assert.equal(s.retargeter.debug().find(d => d.side === 'left' && d.segment === 'upperArm')!.limited, true);
  for (let i = 0; i < 600; i++) {
    const baseFrame = simulatedPose('antipode', 2100 + i * 20, 3000000 + i);
    const f = { ...baseFrame, worldLandmarks: [...baseFrame.worldLandmarks] };
    f.worldLandmarks[13] = { x: 0.2 + (i % 2 ? 1e-8 : -1e-8), y: -0.72, z: 0, visibility: 1 };
    s.retargeter.accept(f, f.timestampMs); s.retargeter.update(f.timestampMs, 0.02);
    assert.ok(left.bone.quaternion.toArray().every(Number.isFinite)); assert.ok(Math.abs(left.bone.quaternion.length() - 1) < 1e-8);
  }
  s.close();
});

test('time-based smoothing agrees at 30/60/120 Hz; reset and dispose prevent later writes', () => {
  const samples = [30, 60, 120].map(hz => { const s = setup(); drive(s.retargeter, 'left', 0, hz / 2, hz); const q = s.arm('Left').bone.quaternion.clone(); s.close(); return q; });
  near(samples[0], samples[1]); near(samples[1], samples[2]);
  const s = setup(); drive(s.retargeter, 'left'); s.retargeter.setPaused(true);
  const paused = s.arm('Left').bone.quaternion.clone(); drive(s.retargeter, 'right', 2000); near(s.arm('Left').bone.quaternion, paused);
  s.retargeter.reset();
  for (const e of s.bones) { assert.deepEqual(e.bone.quaternion.toArray(), e.initialQuaternion.toArray()); assert.deepEqual(e.bone.position.toArray(), e.initialPosition.toArray()); }
  drive(s.retargeter, 'both', 4000); near(s.arm('Left').bone.quaternion, s.arm('Left').initialQuaternion);
  s.retargeter.setPaused(false); s.retargeter.dispose(); drive(s.retargeter, 'both', 6000);
  near(s.arm('Left').bone.quaternion, s.arm('Left').initialQuaternion); disposeObject(s.root);
});

test('missing/incorrect mapping and unsupported transforms warn rather than drive arbitrary bones', () => {
  const s = setup();
  const bad = new Retargeter(s.root, s.bones, [{ ...s.configs[0], expectedBoneName: 'invented' }]);
  assert.equal(bad.debug().length, 0); assert.ok(bad.warnings.length > 0); bad.dispose();
  s.root.scale.set(1, 2, 1);
  const scaled = new Retargeter(s.root, s.bones, s.configs); assert.equal(scaled.debug().length, 0); scaled.dispose();
  s.root.scale.set(-1, 1, 1);
  const negative = new Retargeter(s.root, s.bones, s.configs); assert.equal(negative.debug().length, 0); negative.dispose();
  s.close();
});

test('adapter keeps normalized image coordinates out of world retarget input', () => {
  const points = simulatedPose('left', 0, 0).worldLandmarks;
  const adapted = toRetargetFrame({ normalizedLandmarks: points, worldLandmarks: [] }, 42, 1);
  assert.deepEqual(adapted.worldLandmarks, []); assert.equal(adapted.coordinateSpace, 'mediapipe-world');
});

test('GLB v2 mapping validates schema and enables all fourteen body segments', () => {
  const s = setup();
  const configs = parseRigConfig(JSON.parse(JSON.stringify({ version: 2, bindings: s.configs })));
  assert.equal(configs.filter(c => c.segment === 'forearm' && c.enabled !== false).length, 2);
  assert.equal(s.retargeter.debug().length, 14);
  assert.throws(() => parseRigConfig({ version: 2, bindings: [{ ...configs[0], bonePath: [-1] }] }));
  assert.throws(() => parseRigConfig({ version: 1, bindings: [{ ...configs[0], axisCorrection: [0, 0, 0, 0] }] }));
  assert.throws(() => parseRigConfig({ version: 3, bindings: [] }));
  assert.throws(() => parseRigConfig({ version: 1, bindings: [{ ...configs[0], maxSwingRadians: Infinity }] }));
  s.close();
});

test('near-antipodal noise uses continuous bounded swing and unsupported runtime scale disables safely', () => {
  const s = setup(); drive(s.retargeter, 'antipode');
  let previous = s.arm('Left').bone.quaternion.clone();
  for (let i = 0; i < 120; i++) {
    const base = simulatedPose('neutral', 2100 + i * 20, 3000000 + i);
    const frame = { ...base, worldLandmarks: [...base.worldLandmarks] };
    frame.worldLandmarks[13] = { x: 0.172 + (i % 2 ? 0.0001 : -0.0001), y: -0.72, z: i % 2 ? 0.0001 : -0.0001, visibility: 1 };
    s.retargeter.accept(frame, frame.timestampMs); s.retargeter.update(frame.timestampMs, 0.02);
    const q = s.arm('Left').bone.quaternion;
    assert.ok(previous.angleTo(q) < 0.05); previous.copy(q);
  }
  s.root.scale.set(1, 2, 1); s.retargeter.update(5000, 0.02);
  assert.ok(s.retargeter.debug().every(d => d.state === 'disabled'));
  const warningCount = s.retargeter.warnings.length; s.retargeter.update(5020, 0.02);
  assert.equal(s.retargeter.warnings.length, warningCount); s.close();
});
