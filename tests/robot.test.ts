import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { collectBones, resetBones, rotateBone } from '../src/robot/bones';
import { createFallbackRobot } from '../src/robot/fallback';
import { disposeObject, normalizeModel } from '../src/robot/model';

test('authored fallback exposes a complete hierarchy and responds to joint rotation', () => {
  const root = createFallbackRobot();
  normalizeModel(root);
  const bones = collectBones(root);
  assert.equal(bones.length, 17);
  const arm = bones.find((entry) => entry.name === 'LeftUpperArm')!;
  const hand = bones.find((entry) => entry.name === 'LeftHand')!;
  const initial = hand.bone.getWorldPosition(new THREE.Vector3());
  rotateBone(arm, 2, 70);
  root.updateMatrixWorld(true);
  assert.ok(initial.distanceTo(hand.bone.getWorldPosition(new THREE.Vector3())) > 0.5);
  assert.deepEqual(arm.offset, [0, 0, 70]);
  resetBones(bones);
  root.updateMatrixWorld(true);
  assert.ok(initial.distanceTo(hand.bone.getWorldPosition(new THREE.Vector3())) < 1e-8);
  const bounds = new THREE.Box3().setFromObject(root);
  assert.ok(Math.abs(bounds.min.y) < 1e-8);
  assert.ok(Math.abs(bounds.getSize(new THREE.Vector3()).y - 2.5) < 1e-8);
  disposeObject(root);
});

test('rotation composes with an imported rest pose and rejects invalid values', () => {
  const root = new THREE.Group();
  const bone = new THREE.Bone();
  bone.name = 'actual-rig-joint';
  bone.rotation.set(0.2, -0.4, 0.1);
  root.add(bone);
  const entry = collectBones(root)[0];
  const rest = bone.quaternion.clone();
  rotateBone(entry, 0, 35);
  rotateBone(entry, 2, -50);
  const expected = rest.clone().multiply(new THREE.Quaternion().setFromEuler(
    new THREE.Euler(THREE.MathUtils.degToRad(35), 0, THREE.MathUtils.degToRad(-50), 'XYZ'),
  ));
  assert.ok(bone.quaternion.angleTo(expected) < 1e-7);
  rotateBone(entry, 0, Number.NaN);
  assert.equal(entry.offset[0], 35);
  rotateBone(entry, 1, 900);
  assert.equal(entry.offset[1], 180);
  resetBones([entry]);
  assert.ok(bone.quaternion.angleTo(rest) < 1e-7);
});

test('unnamed/duplicate imported bones retain unique identities and actual ancestry', () => {
  const root = new THREE.Group();
  const parent = new THREE.Bone();
  const child = new THREE.Bone();
  const sibling = new THREE.Bone();
  parent.name = 'duplicate';
  sibling.name = 'duplicate';
  root.add(parent, sibling);
  parent.add(child);
  const entries = collectBones(root);
  assert.deepEqual(entries.map((entry) => entry.depth), [0, 1, 0]);
  assert.equal(new Set(entries.map((entry) => entry.id)).size, 3);
  assert.equal(entries[1].name, '未命名骨骼 2');
});

test('shared render resources are disposed exactly once', () => {
  const root = new THREE.Group();
  const geometry = new THREE.BoxGeometry();
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture });
  root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
  const calls = { geometry: 0, material: 0, texture: 0 };
  geometry.addEventListener('dispose', () => calls.geometry++);
  material.addEventListener('dispose', () => calls.material++);
  texture.addEventListener('dispose', () => calls.texture++);
  disposeObject(root);
  assert.deepEqual(calls, { geometry: 1, material: 1, texture: 1 });
});
