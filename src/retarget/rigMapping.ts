import * as THREE from 'three';
import type { BoneEntry } from '../robot/bones';
import type { RigBindingConfig } from './types';

export function objectPath(root: THREE.Object3D, child: THREE.Object3D): number[] | undefined {
  const path: number[] = [];
  let node = child;
  while (node !== root) {
    const parent = node.parent;
    if (!parent) return;
    path.unshift(parent.children.indexOf(node));
    node = parent;
  }
  return path;
}
export function resolvePath(root: THREE.Object3D, path: readonly number[]): THREE.Object3D | undefined {
  let node: THREE.Object3D | undefined = root;
  for (const index of path) node = node?.children[index];
  return node;
}
/** This preset is only for our authored procedural asset. Unknown GLBs require explicit configuration. */
export function fallbackMapping(root: THREE.Object3D, bones: readonly BoneEntry[]): RigBindingConfig[] {
  return (['left', 'right'] as const).flatMap((side) => {
    const label = side === 'left' ? 'Left' : 'Right';
    const arm = bones.filter(e => e.name === `${label}UpperArm`);
    const end = bones.filter(e => e.name === `${label}Forearm`);
    if (arm.length !== 1 || end.length !== 1) return [];
    const bonePath = objectPath(root, arm[0].bone), endPath = objectPath(root, end[0].bone);
    if (!bonePath || !endPath) return [];
    const result: RigBindingConfig[] = [{ side, segment: 'upperArm', bonePath, endPath, expectedBoneName: arm[0].bone.name, expectedEndName: end[0].bone.name,
      maxSwingRadians: THREE.MathUtils.degToRad(160), axisCorrection: [0, 0, 0, 1] }];
    const hand = bones.filter(e => e.name === label + 'Hand');
    const handPath = hand.length === 1 ? objectPath(root, hand[0].bone) : undefined;
    if (handPath) result.push({ side, segment: 'forearm', enabled: false, bonePath: endPath, endPath: handPath,
      expectedBoneName: end[0].bone.name, expectedEndName: hand[0].bone.name,
      maxSwingRadians: THREE.MathUtils.degToRad(140), axisCorrection: [0, 0, 0, 1] });
    return result;
  });
}

const scaleX = new THREE.Vector3(), scaleY = new THREE.Vector3(), scaleZ = new THREE.Vector3();

/** Quaternion parent conversion is supported only for positive uniform scale without shear. */
export function supportedChain(node: THREE.Object3D | null): boolean {
  const x = scaleX, y = scaleY, z = scaleZ;
  for (let current = node; current; current = current.parent) {
    if (current.scale.x <= 0 || current.scale.y <= 0 || current.scale.z <= 0) return false;
    if (current.matrixAutoUpdate) current.updateMatrix();
    const m = current.matrix;
    x.setFromMatrixColumn(m, 0); y.setFromMatrixColumn(m, 1); z.setFromMatrixColumn(m, 2);
    const a = x.length(), b = y.length(), c = z.length();
    if (![a, b, c, m.determinant()].every(Number.isFinite) || m.determinant() <= 0 || a < 1e-8
      || Math.abs(a - b) > a * 1e-5 || Math.abs(a - c) > a * 1e-5
      || Math.abs(x.dot(y)) > a * a * 1e-5 || Math.abs(x.dot(z)) > a * a * 1e-5 || Math.abs(y.dot(z)) > a * a * 1e-5) return false;
  }
  return true;
}
