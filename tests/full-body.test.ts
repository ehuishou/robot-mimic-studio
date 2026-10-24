import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { collectBones } from '../src/robot/bones';
import { createFallbackRobot } from '../src/robot/fallback';
import { disposeObject } from '../src/robot/model';
import { Retargeter } from '../src/retarget/Retargeter';
import { fallbackMapping, resolvePath } from '../src/retarget/rigMapping';
import { parseRigConfig } from '../src/retarget/loadRigConfig';
import { simulatedPose } from '../src/retarget/simulatedPose';
import type { RetargetFrame } from '../src/retarget/types';

function setup() {
  const root = createFallbackRobot(), bones = collectBones(root), configs = fallbackMapping(root, bones);
  return { root, bones, configs };
}
function settle(r: Retargeter, frame: RetargetFrame, start = 0) {
  for (let step = 1; step <= 300; step++) {
    const now = start + step * 20;
    assert.ok(r.accept({ ...frame, timestampMs: now, seq: now }, now));
    r.update(now, 0.02);
  }
}
function average(frame: RetargetFrame, indices: readonly number[]) {
  const result = new THREE.Vector3();
  for (const i of indices) { const p = frame.worldLandmarks[i]!; result.add(new THREE.Vector3(p.x, p.y, p.z)); }
  return result.divideScalar(indices.length);
}

test('all fourteen segments align in world space with a moving torso, rotated root and reversed mapping order', () => {
  const s = setup(); s.root.rotation.set(0.3, -0.6, 0.2); s.root.scale.setScalar(1.7);
  const configs = s.configs.map(c => ({ ...c, maxSwingRadians: Math.PI })).reverse();
  const r = new Retargeter(s.root, s.bones, configs);
  assert.equal(r.debug().length, 14); assert.deepEqual(r.warnings, []);
  const frame = simulatedPose('full', 0, 0);
  settle(r, frame);
  for (const c of configs) {
    const bone = resolvePath(s.root, c.bonePath)!;
    const end = c.endPath ? resolvePath(s.root, c.endPath) : undefined;
    const reference = end ? end.position.clone() : new THREE.Vector3(...c.referenceDirection!);
    const actual = reference.normalize().applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()));
    const delta = average(frame, c.sourceEnd).sub(average(frame, c.sourceStart));
    const expected = new THREE.Vector3(delta.x, -delta.y, -delta.z).normalize();
    assert.ok(actual.distanceTo(expected) < 1e-4, `${c.expectedBoneName}: error ${actual.distanceTo(expected)}`);
    const debug = r.debug().find(d => d.name === c.expectedBoneName)!;
    assert.ok(new THREE.Vector3(...debug.direction!).distanceTo(expected) < 1e-8);
    assert.equal(debug.state, 'tracking');
  }
  r.dispose(); disposeObject(s.root);
});

test('neutral legs and feet retain rest and forward arm input points toward positive scene z', () => {
  const s = setup(), r = new Retargeter(s.root, s.bones, s.configs);
  settle(r, simulatedPose('neutral', 0, 0));
  for (const e of s.bones.filter(b => /Leg|Foot/.test(b.name))) assert.ok(e.bone.quaternion.angleTo(e.initialQuaternion) < 1e-5, e.name);
  settle(r, simulatedPose('forward', 0, 0), 6000);
  for (const d of r.debug().filter(d => d.segment === 'upperArm')) assert.ok(d.direction![2]! > 0.9999);
  r.dispose(); disposeObject(s.root);
});

test('knee occlusion recovers only dependent leg segments, then all segments recover on complete loss', () => {
  const s = setup(), r = new Retargeter(s.root, s.bones, s.configs);
  settle(r, simulatedPose('full', 0, 0));
  const frame = simulatedPose('full', 0, 0);
  const hidden = { ...frame, worldLandmarks: frame.worldLandmarks.map((p, i) => i === 25 ? { ...p, visibility: 0.1 } : p) };
  settle(r, hidden, 6000);
  for (const d of r.debug()) {
    const lost = d.side === 'left' && (d.segment === 'upperLeg' || d.segment === 'lowerLeg');
    assert.equal(d.state, lost ? 'rest' : 'tracking', d.name);
    if (lost) assert.ok(s.bones.find(e => e.name === d.name)!.initialQuaternion.angleTo(new THREE.Quaternion(...d.actual)) < 1e-5);
  }
  settle(r, simulatedPose('missing', 0, 0), 12000);
  for (const e of s.bones) assert.ok(e.bone.quaternion.angleTo(e.initialQuaternion) < 1e-5, e.name);
  r.dispose(); disposeObject(s.root);
});

test('v2 validates averaged landmark endpoints, terminal references and center/limb sides; v1 stays compatible', () => {
  const s = setup();
  const parsed = parseRigConfig(JSON.parse(JSON.stringify({ version: 2, bindings: s.configs })));
  assert.equal(parsed.length, 14);
  assert.deepEqual(parsed.find(c => c.segment === 'torso')!.sourceStart, [23, 24]);
  const terminal = parsed.find(c => c.segment === 'foot')!;
  assert.deepEqual(terminal.referenceDirection, [0, 0, 1]);
  for (const patch of [{ sourceStart: [] }, { sourceEnd: [33] }, { sourceStart: [NaN] }, { sourceStart: [-1] }, { sourceEnd: [1, 2, 3, 4, 5] }, { referenceDirection: [0, 0, 0] }, { referenceDirection: [NaN, 0, 1] }, { side: 'center' }, { segment: 'unknown' }]) {
    assert.throws(() => parseRigConfig({ version: 2, bindings: [{ ...terminal, ...patch }] }));
  }
  assert.throws(() => parseRigConfig({ version: 2, bindings: [{ ...parsed[0], side: 'left' }] }));
  const legacy = { ...parsed.find(c => c.side === 'left' && c.segment === 'upperArm')! } as Record<string, unknown>;
  delete legacy.segment; delete legacy.sourceStart; delete legacy.sourceEnd;
  const v1 = parseRigConfig({ version: 1, bindings: [legacy] });
  assert.equal(v1[0]!.segment, 'upperArm'); assert.deepEqual(v1[0]!.sourceStart, [11]); assert.deepEqual(v1[0]!.sourceEnd, [13]);
  disposeObject(s.root);
});
