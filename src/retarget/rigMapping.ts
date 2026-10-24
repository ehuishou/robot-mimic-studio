import * as THREE from 'three';
import type { BoneEntry } from '../robot/bones';
import type { BodySegment, RigBindingConfig, MotionRigConfig } from './types';
import { sourceFor } from './sourceMapping';

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
  const result: RigBindingConfig[] = [];
  const add = (name: string, side: RigBindingConfig['side'], segment: BodySegment, childName?: string,
    referenceDirection?: readonly [number, number, number], maxDegrees = 150) => {
    const matches = bones.filter(entry => entry.name === name);
    if (matches.length !== 1) return;
    const bonePath = objectPath(root, matches[0]!.bone);
    if (!bonePath) return;
    const child = childName ? bones.filter(entry => entry.name === childName) : [];
    const endPath = child.length === 1 ? objectPath(root, child[0]!.bone) : undefined;
    if (childName && (!endPath || child[0]!.bone.parent !== matches[0]!.bone)) return;
    if (!endPath && !referenceDirection) return;
    const source = sourceFor(side, segment);
    result.push({ side, segment, sourceStart: source.start, sourceEnd: source.end, bonePath,
      endPath, expectedBoneName: name, expectedEndName: endPath ? childName : undefined, referenceDirection,
      maxSwingRadians: THREE.MathUtils.degToRad(maxDegrees), axisCorrection: [0, 0, 0, 1] });
  };
  add('Spine', 'center', 'torso', 'Chest', undefined, 65);
  add('Neck', 'center', 'neck', 'Head', undefined, 75);
  for (const side of ['left', 'right'] as const) {
    const label = side === 'left' ? 'Left' : 'Right';
    add(`${label}UpperArm`, side, 'upperArm', `${label}Forearm`, undefined, 160);
    add(`${label}Forearm`, side, 'forearm', `${label}Hand`, undefined, 155);
    add(`${label}Hand`, side, 'hand', undefined, [0, -1, 0], 120);
    add(`${label}UpperLeg`, side, 'upperLeg', `${label}LowerLeg`, undefined, 115);
    add(`${label}LowerLeg`, side, 'lowerLeg', `${label}Foot`, undefined, 145);
    add(`${label}Foot`, side, 'foot', undefined, [0, 0, 1], 85);
  }
  return result;
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

/** Only call for the authored fallback, never an unknown imported GLB. */
export function fallbackMotion(root: THREE.Object3D, bones: readonly BoneEntry[]): MotionRigConfig | undefined {
  const matches = bones.filter(b => b.name === 'Hips');
  const hipsPath = matches.length === 1 ? objectPath(root, matches[0]!.bone) : undefined;
  return hipsPath ? { version: 1, hipsPath, expectedHipsName: 'Hips' } : undefined;
}
