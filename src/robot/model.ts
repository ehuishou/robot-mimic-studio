import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createFallbackRobot } from './fallback';
import { collectBones } from './bones';
import type { BoneEntry } from './bones';

export interface RobotModel {
  root: THREE.Group;
  bones: BoneEntry[];
  source: 'glb' | 'fallback';
  notice: string;
  meshCount: number;
}

/** Shared geometries/materials/textures and skinning textures are freed only once. */
export function disposeObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) {
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) textures.add(value);
        }
      }
    }
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
  });
  skeletons.forEach((skeleton) => skeleton.dispose());
  textures.forEach((texture) => {
    const image: unknown = texture.source?.data;
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close();
    texture.dispose();
  });
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  root.removeFromParent();
}

export function normalizeModel(root: THREE.Group): void {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  if (bounds.isEmpty()) throw new Error('模型中没有可显示的几何体');
  const size = bounds.getSize(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxDimension) || maxDimension <= 0) throw new Error('模型尺寸无效');
  root.scale.multiplyScalar(2.5 / maxDimension);
  root.updateMatrixWorld(true);
  const normalizedBounds = new THREE.Box3().setFromObject(root);
  const center = normalizedBounds.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= normalizedBounds.min.y;
  root.updateMatrixWorld(true);
}

export async function loadRobot(signal: AbortSignal): Promise<RobotModel> {
  const url = new URL(`${import.meta.env.BASE_URL}models/robot.glb`, window.location.href);
  let root: THREE.Group | undefined;
  let source: RobotModel['source'] = 'glb';
  let notice = '';
  try {
    const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
    if (!response.ok) throw new Error(response.status === 404 ? '未找到 robot.glb' : `模型请求失败（HTTP ${response.status}）`);
    const data = await response.arrayBuffer();
    if (data.byteLength < 12 || new DataView(data).getUint32(0, true) !== 0x46546c67) {
      throw new Error('未找到有效的 GLB 文件，请检查 public/models/robot.glb');
    }
    const gltf = await new GLTFLoader().parseAsync(data, new URL('.', url).href);
    root = gltf.scene;
    // The viewer is static: retain the actual default pose rather than playing animation clips.
    if (signal.aborted) {
      throw new DOMException('加载已取消', 'AbortError');
    }
    normalizeModel(root);
  } catch (error) {
    if (signal.aborted) {
      if (root) disposeObject(root);
      throw error;
    }
    if (root) disposeObject(root);
    source = 'fallback';
    notice = `${error instanceof Error ? error.message : '模型加载失败'}。已启用内置机器人。`;
    root = createFallbackRobot();
    normalizeModel(root);
  }
  let meshCount = 0;
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      meshCount++;
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return { root, bones: collectBones(root), source, notice, meshCount };
}
