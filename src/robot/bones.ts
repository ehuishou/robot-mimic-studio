import * as THREE from 'three';

export interface BoneEntry {
  id: string;
  name: string;
  depth: number;
  bone: THREE.Bone;
  initialPosition: THREE.Vector3;
  initialQuaternion: THREE.Quaternion;
  initialScale: THREE.Vector3;
  offset: [number, number, number];
}

/** Bone labels always come from the loaded hierarchy; IDs remain unique for unnamed/duplicate bones. */
export function collectBones(root: THREE.Object3D): BoneEntry[] {
  const result: BoneEntry[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Bone)) return;
    let depth = 0;
    for (let parent = object.parent; parent && parent !== root; parent = parent.parent) {
      if (parent instanceof THREE.Bone) depth++;
    }
    result.push({
      id: object.uuid,
      name: object.name.trim() || `未命名骨骼 ${result.length + 1}`,
      depth,
      bone: object,
      initialPosition: object.position.clone(),
      initialQuaternion: object.quaternion.clone(),
      initialScale: object.scale.clone(),
      offset: [0, 0, 0],
    });
  });
  return result;
}

/** XYZ local offsets, in degrees, relative to the actual imported rest pose. */
export function rotateBone(entry: BoneEntry, axis: 0 | 1 | 2, degrees: number): void {
  if (!Number.isFinite(degrees)) return;
  entry.offset[axis] = THREE.MathUtils.clamp(degrees, -180, 180);
  const [x, y, z] = entry.offset.map(THREE.MathUtils.degToRad);
  entry.bone.quaternion.copy(entry.initialQuaternion).multiply(
    new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ')),
  );
  entry.bone.updateMatrixWorld(true);
}

export function resetBones(entries: BoneEntry[]): void {
  for (const entry of entries) {
    entry.bone.position.copy(entry.initialPosition);
    entry.bone.quaternion.copy(entry.initialQuaternion);
    entry.bone.scale.copy(entry.initialScale);
    entry.offset = [0, 0, 0];
  }
}
