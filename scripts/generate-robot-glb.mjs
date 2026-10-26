import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
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
  new THREE.MeshStandardMaterial({ name: 'Shell', color: 0xe5e6df, roughness: 0.3, metalness: 0.24 }),
  new THREE.MeshStandardMaterial({ name: 'Dark', color: 0x28302f, roughness: 0.4, metalness: 0.65 }),
  new THREE.MeshStandardMaterial({ name: 'Accent', color: 0x95ad83, roughness: 0.35, metalness: 0.45 }),
  new THREE.MeshStandardMaterial({ name: 'Glow', color: 0xd5edb7, emissive: 0xb5db8f, emissiveIntensity: 1.1, roughness: 0.3, metalness: 0.1 }),
  new THREE.MeshStandardMaterial({ name: 'Visor', color: 0x121e22, roughness: 0.14, metalness: 0.72 }),
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

  add(geometry, bone, materialIndex, offset = [0, 0, 0], rotation = [0, 0, 0]) {
    const source = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    const transform = new THREE.Matrix4().copy(bone.matrixWorld).multiply(new THREE.Matrix4().compose(new THREE.Vector3(...offset), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(1, 1, 1)));
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
    geometry.dispose();
  }

  box(bone, size, offset, materialIndex, radius = 0.035, taper = 0) {
    const geometry = new RoundedBoxGeometry(...size, 2, Math.min(radius, Math.min(...size) * 0.45));
    if (taper) {
      const p = geometry.getAttribute('position');
      const n = geometry.getAttribute('normal');
      const normal = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const scale = 1 + taper * y / size[1];
        // Inverse-transpose of the taper Jacobian preserves smooth bevel normals.
        normal.set(n.getX(i) / scale,
          n.getY(i) - taper / size[1] * (x * n.getX(i) + z * n.getZ(i)) / scale,
          n.getZ(i) / scale).normalize();
        n.setXYZ(i, normal.x, normal.y, normal.z);
        p.setXYZ(i, x * scale, y, z * scale);
      }
    }
    this.add(geometry, bone, materialIndex, offset);
  }

  cylinder(bone, radius, length, offset, materialIndex = 1, axis = 'x') {
    this.add(new THREE.CylinderGeometry(radius, radius, length, 20), bone, materialIndex, offset,
      axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0]);
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
    // One primitive per material instead of one per part. Skin weights and bone order stay intact.
    const batchedIndices = [];
    for (let materialIndex = 0; materialIndex < materials.length; materialIndex++) {
      const start = batchedIndices.length;
      for (const group of this.groups) {
        if (group.materialIndex !== materialIndex) continue;
        for (let i = group.start; i < group.start + group.count; i++) batchedIndices.push(this.indices[i]);
      }
      if (batchedIndices.length > start) geometry.addGroup(start, batchedIndices.length - start, materialIndex);
    }
    geometry.setIndex(batchedIndices);
    const compact = mergeVertices(geometry);
    geometry.dispose();
    compact.computeBoundingBox();
    compact.computeBoundingSphere();
    return compact;
  }
}

function createRobot() {
  const rig = createRig();
  rig.root.updateMatrixWorld(true);
  const boneIndices = new Map(rig.bones.map((bone, index) => [bone, index]));
  const parts = new SkinnedPartBuilder(boneIndices);
  const box = (bone, size, offset, materialIndex = 0, radius = 0.055) => parts.box(bone, size, offset, materialIndex, radius);
  const sphere = (bone, radius, materialIndex = 1) => parts.sphere(bone, radius, materialIndex);

  const cylinder = (...args) => parts.cylinder(...args);
  const panel = (bone, size, offset, materialIndex = 0, taper = 0) => parts.box(bone, size, offset, materialIndex, 0.025, taper);
  // Rigid armor panels follow the original joint weights. Seams expose the structural frame.
  box(rig.hips, [0.48, 0.24, 0.3], [0, 0, 0], 1);
  panel(rig.hips, [0.36, 0.105, 0.335], [0, 0.04, 0]);
  panel(rig.hips, [0.23, 0.105, 0.035], [0, -0.075, 0.16], 0, 0.2);
  box(rig.spine, [0.26, 0.25, 0.235], [0, 0.065, 0], 1);
  for (let i = 0; i < 3; i++) {
    panel(rig.spine, [0.28, 0.038, 0.04], [0, 0.005 + i * 0.068, 0.13], i === 1 ? 2 : 1);
  }
  panel(rig.chest, [0.62, 0.43, 0.33], [0, 0.135, 0], 0, 0.3);
  panel(rig.chest, [0.48, 0.185, 0.035], [0, 0.22, 0.177], 1, 0.14);
  box(rig.chest, [0.19, 0.014, 0.018], [-0.09, 0.24, 0.201], 3, 0.006);
  box(rig.chest, [0.045, 0.014, 0.018], [0.085, 0.24, 0.201], 2, 0.006);
  for (const side of [-1, 1]) {
    panel(rig.chest, [0.12, 0.115, 0.024], [side * 0.2, 0.035, 0.17]);
    cylinder(rig.chest, 0.012, 0.012, [side * 0.205, 0.275, 0.202], 2, 'z');
  }
  // Recessed rear service cartridge and its ventilation slots.
  panel(rig.chest, [0.37, 0.29, 0.055], [0, 0.14, -0.18], 1);
  panel(rig.chest, [0.28, 0.22, 0.022], [0, 0.145, -0.217]);
  for (let i = 0; i < 4; i++) box(rig.chest, [0.18, 0.013, 0.008], [0, 0.09 + i * 0.035, -0.231], 1, 0.004);
  cylinder(rig.neck, 0.073, 0.115, [0, 0.035, 0], 1, 'y');
  cylinder(rig.neck, 0.081, 0.023, [0, 0.035, 0], 2, 'y');
  box(rig.head, [0.46, 0.38, 0.36], [0, 0.1, 0], 0, 0.095);
  box(rig.head, [0.383, 0.157, 0.055], [0, 0.127, 0.17], 1, 0.04);
  box(rig.head, [0.354, 0.126, 0.026], [0, 0.13, 0.2], 4, 0.04);
  for (const side of [-1, 1]) {
    cylinder(rig.head, 0.033, 0.012, [side * 0.095, 0.135, 0.219], 1, 'z');
    cylinder(rig.head, 0.021, 0.016, [side * 0.095, 0.135, 0.226], 3, 'z');
    cylinder(rig.head, 0.063, 0.025, [side * 0.225, 0.11, 0], 1);
    cylinder(rig.head, 0.045, 0.029, [side * 0.23, 0.11, 0], 0);
    box(rig.head, [0.008, 0.04, 0.075], [side * 0.248, 0.11, 0], 2, 0.003);
  }
  box(rig.head, [0.105, 0.012, 0.018], [0, -0.015, 0.18], 1, 0.005);
  panel(rig.head, [0.21, 0.038, 0.012], [0, 0.215, -0.17], 1);

  const byName = new Map(rig.bones.map((bone) => [bone.name, bone]));
  for (const side of [-1, 1]) {
    const label = side > 0 ? 'Left' : 'Right';
    const upperArm = byName.get(label + 'UpperArm');
    const forearm = byName.get(label + 'Forearm');
    const hand = byName.get(label + 'Hand');
    const upperLeg = byName.get(label + 'UpperLeg');
    const lowerLeg = byName.get(label + 'LowerLeg');
    const foot = byName.get(label + 'Foot');
    if (!upperArm || !forearm || !hand || !upperLeg || !lowerLeg || !foot) throw new Error('Missing ' + label + ' robot bones.');

    // Hinge hubs are centered exactly on the existing pivots.
    const hinge = (bone, radius, width) => {
      cylinder(bone, radius, width, [0, 0, 0]);
      cylinder(bone, radius * 0.7, 0.018, [side * (width / 2 + 0.008), 0, 0], 0);
      cylinder(bone, radius * 0.29, 0.021, [side * (width / 2 + 0.018), 0, 0], 2);
    };
    hinge(upperArm, 0.121, 0.22);
    panel(upperArm, [0.23, 0.285, 0.245], [side * 0.025, -0.2, 0], 0, 0.17);
    panel(upperArm, [0.245, 0.075, 0.26], [side * 0.025, -0.085, 0], 0);
    box(upperArm, [0.06, 0.014, 0.012], [side * 0.025, -0.08, 0.137], 2, 0.005);
    panel(upperArm, [0.08, 0.12, 0.018], [side * 0.035, -0.22, -0.128], 1);
    hinge(forearm, 0.09, 0.18);
    panel(forearm, [0.21, 0.285, 0.225], [0, -0.19, 0], 0, 0.18);
    panel(forearm, [0.095, 0.15, 0.018], [0, -0.19, 0.119], 1);
    box(forearm, [0.038, 0.055, 0.01], [0, -0.145, 0.132], 2, 0.006);
    cylinder(hand, 0.067, 0.075, [0, 0.012, 0], 1, 'y');
    cylinder(hand, 0.071, 0.018, [0, 0.015, 0], 2, 'y');
    box(hand, [0.15, 0.105, 0.17], [0, -0.055, 0.008], 1, 0.025);
    panel(hand, [0.125, 0.065, 0.028], [0, -0.047, 0.097]);
    for (let i = 0; i < 3; i++) {
      box(hand, [0.038, 0.073, 0.10], [(i - 1) * 0.05, -0.137, 0.015], 1, 0.014);
      panel(hand, [0.031, 0.027, 0.018], [(i - 1) * 0.05, -0.123, 0.068]);
    }
    box(hand, [0.045, 0.075, 0.09], [-side * 0.091, -0.08, 0.035], 1, 0.018);

    sphere(upperLeg, 0.108);
    panel(upperLeg, [0.26, 0.345, 0.275], [0, -0.23, 0], 0, 0.17);
    panel(upperLeg, [0.115, 0.21, 0.018], [0, -0.225, 0.146]);
    box(upperLeg, [0.058, 0.014, 0.013], [0, -0.18, 0.162], 2, 0.005);
    hinge(lowerLeg, 0.096, 0.215);
    panel(lowerLeg, [0.135, 0.105, 0.042], [0, -0.02, 0.097], 0, 0.1);
    panel(lowerLeg, [0.245, 0.285, 0.255], [0, -0.225, 0], 0, 0.2);
    panel(lowerLeg, [0.09, 0.18, 0.018], [0, -0.215, 0.14], 1);
    box(lowerLeg, [0.038, 0.055, 0.012], [0, -0.15, 0.154], 2, 0.006);
    cylinder(foot, 0.07, 0.175, [0, 0, 0]);
    box(foot, [0.29, 0.13, 0.43], [0, -0.068, 0.09], 1, 0.04);
    box(foot, [0.295, 0.035, 0.435], [0, -0.1225, 0.09], 0, 0.014);
    panel(foot, [0.25, 0.07, 0.21], [0, -0.045, 0.17], 0, 0.08);
    for (const x of [-0.07, 0.07]) box(foot, [0.012, 0.008, 0.12], [x, -0.007, 0.175], 1, 0.003);
    box(foot, [0.10, 0.02, 0.016], [0, -0.07, -0.133], 2, 0.005);
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
  return { version: 2, asset: 'robot.glb', generatedBy: 'scripts/generate-robot-glb.mjs', bindings, motion: { version: 1, hipsPath: findNodePath(gltf, 'Hips'), expectedHipsName: 'Hips' } };
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
