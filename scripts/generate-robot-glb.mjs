import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const modelsDirectory = path.join(projectRoot, 'public', 'models');
const glbPath = path.join(modelsDirectory, 'robot.glb');
const mappingPath = path.join(modelsDirectory, 'robot.mapping.json');

/** GLTFExporter uses FileReader for the binary callback. Node has Blob, but not FileReader. */
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class NodeFileReader {
    result = null;
    onloadend = null;
    onerror = null;

    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((value) => {
        this.result = value;
        this.onloadend?.({ target: this });
      }).catch((error) => this.onerror?.(error));
    }

    readAsDataURL(blob) {
      blob.arrayBuffer().then((value) => {
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(value).toString('base64')}`;
        this.onloadend?.({ target: this });
      }).catch((error) => this.onerror?.(error));
    }
  };
}

const materials = [
  new THREE.MeshStandardMaterial({ name: 'Shell', color: 0xe3e8dc, roughness: 0.33, metalness: 0.28 }),
  new THREE.MeshStandardMaterial({ name: 'Dark', color: 0x252f2c, roughness: 0.48, metalness: 0.5 }),
  new THREE.MeshStandardMaterial({ name: 'Accent', color: 0xb7eb7f, roughness: 0.3, metalness: 0.25 }),
  new THREE.MeshStandardMaterial({ name: 'Glow', color: 0xc8ffa4, emissive: 0x9adf68, emissiveIntensity: 1.8, roughness: 0.3, metalness: 0.1 }),
  new THREE.MeshStandardMaterial({ name: 'Visor', color: 0x101f1a, roughness: 0.17, metalness: 0.65 }),
];

function createBone(name, parent, position) {
  const bone = new THREE.Bone();
  bone.name = name;
  bone.position.set(...position);
  parent.add(bone);
  return bone;
}

function createRig() {
  const root = new THREE.Group();
  root.name = 'RobotStudioRobot';

  const hips = createBone('Hips', root, [0, 1.13, 0]);
  const spine = createBone('Spine', hips, [0, 0.18, 0]);
  const chest = createBone('Chest', spine, [0, 0.18, 0]);
  const neck = createBone('Neck', chest, [0, 0.41, 0]);
  const head = createBone('Head', neck, [0, 0.12, 0]);
  const bones = [hips, spine, chest, neck, head];

  for (const side of [-1, 1]) {
    const label = side > 0 ? 'Left' : 'Right';
    const upperArm = createBone(`${label}UpperArm`, chest, [side * 0.43, 0.24, 0]);
    const forearm = createBone(`${label}Forearm`, upperArm, [side * 0.035, -0.4, 0]);
    const hand = createBone(`${label}Hand`, forearm, [0, -0.4, 0]);
    const upperLeg = createBone(`${label}UpperLeg`, hips, [side * 0.17, -0.13, 0]);
    const lowerLeg = createBone(`${label}LowerLeg`, upperLeg, [0, -0.47, 0]);
    const foot = createBone(`${label}Foot`, lowerLeg, [0, -0.4, 0]);
    bones.push(upperArm, forearm, hand, upperLeg, lowerLeg, foot);
  }

  return { root, bones, hips, spine, chest, neck, head };
}

class SkinnedPartBuilder {
  positions = [];
  normals = [];
  uvs = [];
  skinIndices = [];
  skinWeights = [];
  indices = [];
  groups = [];

  constructor(boneIndices) {
    this.boneIndices = boneIndices;
  }

  add(geometry, bone, materialIndex, offset = [0, 0, 0]) {
    const source = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    const transform = new THREE.Matrix4().copy(bone.matrixWorld).multiply(new THREE.Matrix4().makeTranslation(...offset));
    source.applyMatrix4(transform);

    const position = source.getAttribute('position');
    const normal = source.getAttribute('normal');
    const uv = source.getAttribute('uv');
    if (!position || !normal || !uv) throw new Error('Robot part is missing positions, normals, or UVs.');

    const vertexStart = this.positions.length / 3;
    const indexStart = this.indices.length;
    for (let i = 0; i < position.count; i++) {
      this.positions.push(position.getX(i), position.getY(i), position.getZ(i));
      this.normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      this.uvs.push(uv.getX(i), uv.getY(i));
      this.skinIndices.push(this.boneIndices.get(bone), 0, 0, 0);
      this.skinWeights.push(1, 0, 0, 0);
      this.indices.push(vertexStart + i);
    }
    this.groups.push({ start: indexStart, count: position.count, materialIndex });
    source.dispose();
  }

  box(bone, size, offset, materialIndex, radius = 0.055) {
    this.add(new RoundedBoxGeometry(...size, 3, radius), bone, materialIndex, offset);
  }

  sphere(bone, radius, materialIndex = 1) {
    this.add(new THREE.SphereGeometry(radius, 16, 10), bone, materialIndex);
  }

  build() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skinIndices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.skinWeights, 4));
    geometry.setIndex(this.indices);
    for (const group of this.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

function createRobot() {
  const rig = createRig();
  rig.root.updateMatrixWorld(true);
  const boneIndices = new Map(rig.bones.map((bone, index) => [bone, index]));
  const parts = new SkinnedPartBuilder(boneIndices);
  const box = (bone, size, offset, materialIndex = 0, radius = 0.055) => parts.box(bone, size, offset, materialIndex, radius);
  const sphere = (bone, radius, materialIndex = 1) => parts.sphere(bone, radius, materialIndex);

  // Torso and head.
  box(rig.hips, [0.48, 0.24, 0.3], [0, 0, 0], 1);
  box(rig.hips, [0.38, 0.11, 0.325], [0, 0.035, 0], 0, 0.03);
  box(rig.spine, [0.3, 0.25, 0.25], [0, 0.065, 0], 1);
  box(rig.chest, [0.67, 0.46, 0.35], [0, 0.13, 0], 0);
  box(rig.chest, [0.49, 0.22, 0.035], [0, 0.19, 0.18], 1, 0.03);
  box(rig.chest, [0.18, 0.024, 0.022], [-0.09, 0.22, 0.205], 3, 0.008);
  box(rig.chest, [0.055, 0.024, 0.022], [0.075, 0.22, 0.205], 2, 0.008);
  sphere(rig.neck, 0.095);
  box(rig.head, [0.46, 0.38, 0.36], [0, 0.1, 0], 0, 0.095);
  box(rig.head, [0.365, 0.15, 0.05], [0, 0.12, 0.17], 4, 0.04);
  box(rig.head, [0.09, 0.025, 0.024], [-0.095, 0.125, 0.2], 3, 0.009);
  box(rig.head, [0.09, 0.025, 0.024], [0.095, 0.125, 0.2], 3, 0.009);
  box(rig.head, [0.13, 0.022, 0.018], [0, -0.015, 0.18], 1, 0.008);

  const byName = new Map(rig.bones.map((bone) => [bone.name, bone]));
  for (const side of [-1, 1]) {
    const label = side > 0 ? 'Left' : 'Right';
    const upperArm = byName.get(`${label}UpperArm`);
    const forearm = byName.get(`${label}Forearm`);
    const hand = byName.get(`${label}Hand`);
    const upperLeg = byName.get(`${label}UpperLeg`);
    const lowerLeg = byName.get(`${label}LowerLeg`);
    const foot = byName.get(`${label}Foot`);
    if (!upperArm || !forearm || !hand || !upperLeg || !lowerLeg || !foot) throw new Error(`Missing ${label} robot bones.`);

    sphere(upperArm, 0.13);
    box(upperArm, [0.23, 0.33, 0.25], [side * 0.025, -0.19, 0], 0);
    box(upperArm, [0.24, 0.08, 0.27], [side * 0.025, -0.09, 0], 2, 0.025);
    sphere(forearm, 0.095);
    box(forearm, [0.21, 0.31, 0.235], [0, -0.19, 0], 0);
    sphere(hand, 0.07);
    box(hand, [0.19, 0.19, 0.22], [0, -0.085, 0.015], 1, 0.045);

    sphere(upperLeg, 0.115);
    box(upperLeg, [0.26, 0.37, 0.28], [0, -0.23, 0], 0);
    sphere(lowerLeg, 0.105);
    box(lowerLeg, [0.245, 0.33, 0.27], [0, -0.205, 0], 0);
    box(lowerLeg, [0.14, 0.08, 0.04], [0, -0.06, 0.15], 2, 0.02);
    sphere(foot, 0.075);
    box(foot, [0.29, 0.15, 0.43], [0, -0.065, 0.09], 1, 0.045);
    box(foot, [0.295, 0.045, 0.435], [0, -0.12, 0.09], 0, 0.015);
  }

  const skeleton = new THREE.Skeleton(rig.bones);
  const mesh = new THREE.SkinnedMesh(parts.build(), materials);
  mesh.name = 'RobotSkin';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.bind(skeleton, new THREE.Matrix4());
  rig.root.add(mesh);
  rig.root.updateMatrixWorld(true);
  return rig.root;
}

function readGlbJson(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (view.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error('Generated output is not a GLB 2.0 file.');
  }
  const declaredLength = view.getUint32(8, true);
  if (declaredLength !== view.byteLength) throw new Error('GLB header length differs from the file length.');
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (type === 0x4e4f534a) {
      const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset + offset + 8, length);
      return JSON.parse(new TextDecoder().decode(bytes).trim());
    }
    offset += 8 + length;
  }
  throw new Error('Generated GLB has no JSON chunk.');
}

function findNodePath(gltf, name) {
  const nodes = gltf.nodes ?? [];
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  const visit = (nodeIndex, pathToNode, active = new Set()) => {
    if (active.has(nodeIndex)) return;
    const node = nodes[nodeIndex];
    if (!node) return;
    if (node.name === name) return pathToNode;
    const nextActive = new Set(active).add(nodeIndex);
    for (let childIndex = 0; childIndex < (node.children ?? []).length; childIndex++) {
      const found = visit(node.children[childIndex], [...pathToNode, childIndex], nextActive);
      if (found) return found;
    }
    return undefined;
  };
  for (let rootChildIndex = 0; rootChildIndex < (scene?.nodes ?? []).length; rootChildIndex++) {
    const found = visit(scene.nodes[rootChildIndex], [rootChildIndex]);
    if (found) return found;
  }
  throw new Error(`Could not find exported bone: ${name}`);
}

function makeMapping(gltf) {
  const bindings = [];
  const add = (name, side, segment, start, end, child, referenceDirection, degrees) => {
    bindings.push({ side, segment, enabled: true, sourceStart: start, sourceEnd: end,
      bonePath: findNodePath(gltf, name), expectedBoneName: name,
      ...(child ? { endPath: findNodePath(gltf, child), expectedEndName: child } : { referenceDirection }),
      maxSwingRadians: THREE.MathUtils.degToRad(degrees), axisCorrection: [0, 0, 0, 1] });
  };
  add('Spine', 'center', 'torso', [23, 24], [11, 12], 'Chest', undefined, 65);
  add('Neck', 'center', 'neck', [11, 12], [0], 'Head', undefined, 75);
  for (const side of ['left', 'right']) {
    const label = side === 'left' ? 'Left' : 'Right';
    const i = side === 'left' ? 0 : 1;
    add(label + 'UpperArm', side, 'upperArm', [11 + i], [13 + i], label + 'Forearm', undefined, 160);
    add(label + 'Forearm', side, 'forearm', [13 + i], [15 + i], label + 'Hand', undefined, 155);
    add(label + 'Hand', side, 'hand', [15 + i], [17 + i, 19 + i], undefined, [0, -1, 0], 120);
    add(label + 'UpperLeg', side, 'upperLeg', [23 + i], [25 + i], label + 'LowerLeg', undefined, 115);
    add(label + 'LowerLeg', side, 'lowerLeg', [25 + i], [27 + i], label + 'Foot', undefined, 145);
    add(label + 'Foot', side, 'foot', [27 + i], [31 + i], undefined, [0, 0, 1], 85);
  }
  return { version: 2, asset: 'robot.glb', generatedBy: 'scripts/generate-robot-glb.mjs', bindings };
}

await mkdir(modelsDirectory, { recursive: true });
const robot = createRobot();
const exporter = new GLTFExporter();
const result = await exporter.parseAsync(robot, {
  binary: true,
  trs: true,
  onlyVisible: true,
  maxTextureSize: 1024,
});
if (!(result instanceof ArrayBuffer)) throw new Error('GLTFExporter did not return a binary GLB.');

const glb = Buffer.from(result);
const gltf = readGlbJson(glb);
const mapping = makeMapping(gltf);
await writeFile(glbPath, glb);
await writeFile(mappingPath, `${JSON.stringify(mapping, null, 2)}\n`, 'utf8');

const skin = gltf.skins?.[0];
console.log(`Wrote ${path.relative(projectRoot, glbPath)} (${glb.byteLength} bytes)`);
console.log(`Wrote ${path.relative(projectRoot, mappingPath)}`);
console.log(`Rig: ${skin?.joints?.length ?? 0} joints, ${gltf.meshes?.length ?? 0} mesh, ${gltf.materials?.length ?? 0} materials`);
