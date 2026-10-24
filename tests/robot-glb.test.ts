import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { collectBones } from '../src/robot/bones';
import { disposeObject } from '../src/robot/model';
import { parseRigConfig } from '../src/retarget/loadRigConfig';
import { resolvePath } from '../src/retarget/rigMapping';
import { Retargeter } from '../src/retarget/Retargeter';
import { simulatedPose } from '../src/retarget/simulatedPose';

// GLTFLoader reports progress through this browser API; binary parsing does not need network progress.
if (typeof globalThis.ProgressEvent === 'undefined') {
  Object.defineProperty(globalThis, 'ProgressEvent', {
    configurable: true,
    value: class NodeProgressEvent extends Event {
      lengthComputable;
      loaded;
      total;
      constructor(type: string, init: { lengthComputable?: boolean; loaded?: number; total?: number } = {}) {
        super(type);
        this.lengthComputable = init.lengthComputable ?? false;
        this.loaded = init.loaded ?? 0;
        this.total = init.total ?? 0;
      }
    },
  });
}

test('delivery robot.glb loads as a 17-joint skinned model and its exported mapping drives both arms', async () => {
  const [file, mappingText] = await Promise.all([
    readFile(new URL('../public/models/robot.glb', import.meta.url)),
    readFile(new URL('../public/models/robot.mapping.json', import.meta.url), 'utf8'),
  ]);
  assert.equal(file.readUInt32LE(0), 0x46546c67, 'GLB magic');
  assert.equal(file.readUInt32LE(4), 2, 'GLB version');
  assert.equal(file.readUInt32LE(8), file.byteLength, 'GLB declared length');

  const data = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const gltf = await new GLTFLoader().parseAsync(data, '');
  const root = gltf.scene;
  const bones = collectBones(root);
  const boneByName = new Map(bones.map((entry) => [entry.name, entry]));
  assert.equal(bones.length, 17);
  for (const name of [
    'Hips', 'Spine', 'Chest', 'Neck', 'Head',
    'LeftUpperArm', 'LeftForearm', 'LeftHand', 'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot',
    'RightUpperArm', 'RightForearm', 'RightHand', 'RightUpperLeg', 'RightLowerLeg', 'RightFoot',
  ]) assert.ok(boneByName.has(name), `missing ${name}`);

  const skinnedMeshes: THREE.SkinnedMesh[] = [];
  root.traverse((object) => { if (object instanceof THREE.SkinnedMesh) skinnedMeshes.push(object); });
  assert.ok(skinnedMeshes.length > 0, 'must contain actual SkinnedMesh nodes');
  for (const mesh of skinnedMeshes) {
    assert.equal(mesh.skeleton.bones.length, 17);
    const joints = mesh.geometry.getAttribute('skinIndex');
    const weights = mesh.geometry.getAttribute('skinWeight');
    assert.ok(joints && weights, 'skin joint and weight attributes exist');
    for (let i = 0; i < weights.count; i++) {
      let total = 0;
      for (let slot = 0; slot < 4; slot++) {
        const weight = weights.getComponent(i, slot);
        total += weight;
        if (weight > 0) assert.ok(joints.getComponent(i, slot) < mesh.skeleton.bones.length);
      }
      assert.ok(Math.abs(total - 1) < 1e-5, `vertex ${i} weights sum to one`);
    }
  }

  const configs = parseRigConfig(JSON.parse(mappingText));
  assert.equal(configs.length, 4);
  assert.equal(configs.filter((config) => config.enabled === true).length, 2);
  for (const config of configs) {
    const bone = resolvePath(root, config.bonePath);
    const end = resolvePath(root, config.endPath);
    assert.equal(bone?.name, config.expectedBoneName);
    assert.equal(end?.name, config.expectedEndName);
    assert.equal(end?.parent, bone, `${config.expectedEndName} is a direct child of ${config.expectedBoneName}`);
  }

  const retargeter = new Retargeter(root, bones, configs);
  assert.deepEqual(retargeter.warnings, []);
  assert.equal(retargeter.debug().length, 2);
  const original = new Map(bones.filter((entry) => entry.name.endsWith('UpperArm')).map((entry) => [entry.name, entry.initialQuaternion.clone()]));
  for (let step = 1; step <= 100; step++) {
    const now = step * 1000 / 60;
    retargeter.accept(simulatedPose('left', now, step), now);
    retargeter.update(now, 1 / 60);
  }
  assert.ok(boneByName.get('LeftUpperArm')!.bone.quaternion.angleTo(original.get('LeftUpperArm')!) > 0.5);
  assert.ok(boneByName.get('RightUpperArm')!.bone.quaternion.angleTo(original.get('RightUpperArm')!) < 1e-5);
  retargeter.dispose();
  disposeObject(root);
});
