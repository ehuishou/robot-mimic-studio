// Synthetic skin/joints fixture only; not a delivery robot asset.
export function fixtureGLB(withRig = true) {
  const bytes = Buffer.alloc(144);
  [-0.5, 0, 0, 0.5, 0, 0, 0, 2, 0].forEach((value, i) => bytes.writeFloatLE(value, i * 4));
  for (let i = 0; i < 3; i++) {
    bytes.writeFloatLE(1, 36 + i * 12 + 8);
    bytes.writeFloatLE(1, 96 + i * 16);
  }
  const gltf = {
    asset: { version: '2.0', generator: 'Robot Studio browser fixture' },
    scene: 0, scenes: [{ nodes: [0] }],
    nodes: withRig ? [
      { name: 'FixtureArmature', children: [1, 4] },
      { name: 'ActualRoot', children: [2] },
      { name: 'CustomElbow', translation: [0, 1, 0], children: [3] },
      { name: 'CustomWrist', translation: [0, 0.5, 0] }, { mesh: 0, skin: 0 },
    ] : [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: withRig ? { POSITION: 0, NORMAL: 1, JOINTS_0: 2, WEIGHTS_0: 3 } : { POSITION: 0, NORMAL: 1 }, material: 0 }] }],
    materials: [{ doubleSided: true }], buffers: [{ byteLength: bytes.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 36 },
      { buffer: 0, byteOffset: 72, byteLength: 24 }, { buffer: 0, byteOffset: 96, byteLength: 48 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-0.5, 0, 0], max: [0.5, 2, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: 3, type: 'VEC4' },
      { bufferView: 3, componentType: 5126, count: 3, type: 'VEC4' },
    ], ...(withRig ? { skins: [{ joints: [1, 2, 3] }] } : {}),
  };
  let json = Buffer.from(JSON.stringify(gltf));
  json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const result = Buffer.alloc(28 + json.length + bytes.length);
  result.writeUInt32LE(0x46546c67, 0); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(json.length, 12); result.writeUInt32LE(0x4e4f534a, 16); json.copy(result, 20);
  const offset = 20 + json.length;
  result.writeUInt32LE(bytes.length, offset); result.writeUInt32LE(0x004e4942, offset + 4); bytes.copy(result, offset + 8);
  return result;
}
