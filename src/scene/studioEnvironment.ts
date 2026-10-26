import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// The display remains purely visual; the robot's original foot datum is unchanged.
const DECK_Y = -0.0075;
const FLOOR_Y = -0.17;

export function createStudioEnvironment(renderer: THREE.WebGLRenderer): {
  root: THREE.Group;
  grid: THREE.GridHelper;
  environment: THREE.WebGLRenderTarget;
} {
  const room = new RoomEnvironment();
  const generator = new THREE.PMREMGenerator(renderer);
  let environment: THREE.WebGLRenderTarget;
  try {
    environment = generator.fromScene(room, 0.04);
  } finally {
    room.dispose();
    generator.dispose();
  }

  const root = new THREE.Group();
  root.name = 'studio-environment';
  // Shared material roles: matte floor, graphite chassis, satin aluminium and deck.
  const graphite = new THREE.MeshStandardMaterial({ color: '#30363b', metalness: 0.55, roughness: 0.48 });
  const aluminium = new THREE.MeshStandardMaterial({ color: '#a7adae', metalness: 0.82, roughness: 0.32 });
  const deck = new THREE.MeshStandardMaterial({ color: '#7b8182', metalness: 0.42, roughness: 0.64 });
  const marking = new THREE.MeshStandardMaterial({ color: '#d4d6cf', metalness: 0.35, roughness: 0.48 });
  const recess = new THREE.MeshStandardMaterial({ color: '#171e23', metalness: 0.25, roughness: 0.74 });
  const signal = new THREE.MeshStandardMaterial({
    color: '#91a995', metalness: 0.25, roughness: 0.4,
    emissive: '#758f79', emissiveIntensity: 0.32,
  });

  const addMesh = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };
  const lathe = (profile: [number, number][]) => new THREE.LatheGeometry(
    profile.map(([radius, y]) => new THREE.Vector2(radius, y)), 128,
  );
  const floor = addMesh('matte-laboratory-floor', new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: '#41474b', metalness: 0.08, roughness: 0.88 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;

  // Turned profiles produce real bevel highlights without stacking hard cylinders.
  addMesh('recessed-graphite-plinth', lathe([
    [0, -0.163], [1.36, -0.163], [1.42, -0.151], [1.46, -0.13],
    [1.46, -0.091], [1.44, -0.079], [0, -0.079],
  ]), graphite);
  addMesh('lower-machined-edge', lathe([
    [1.43, -0.128], [1.466, -0.123], [1.466, -0.116], [1.44, -0.111],
  ]), aluminium);
  addMesh('machined-upper-tray', lathe([
    [0, -0.091], [1.45, -0.091], [1.49, -0.077], [1.5, -0.059],
    [1.5, -0.03], [1.491, -0.017], [1.476, -0.0095], [0, -0.0095],
  ]), aluminium);
  const seal = addMesh('circumferential-service-seam',
    new THREE.CylinderGeometry(1.501, 1.501, 0.007, 128, 1, true), recess);
  seal.position.y = -0.064;
  const insert = addMesh('satin-working-deck',
    new THREE.CylinderGeometry(1.365, 1.376, 0.025, 128), deck);
  insert.position.y = DECK_Y - 0.0125;

  const ring = (name: string, inner: number, outer: number, y: number, material: THREE.Material) => {
    const mesh = addMesh(name, new THREE.RingGeometry(inner, outer, 128), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    return mesh;
  };
  ring('inset-deck-joint', 1.366, 1.378, -0.009, recess);
  ring('fine-tooling-line', 1.388, 1.391, -0.009, graphite);

  const transform = new THREE.Object3D();
  const instance = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material,
    count: number, place: (index: number, object: THREE.Object3D) => void) => {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = name;
    mesh.receiveShadow = true;
    for (let index = 0; index < count; index++) {
      transform.position.set(0, 0, 0);
      transform.rotation.set(0, 0, 0);
      transform.scale.set(1, 1, 1);
      place(index, transform);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    root.add(mesh);
    return mesh;
  };
  const radial = (object: THREE.Object3D, angle: number, radius: number, y: number) => {
    object.position.set(Math.sin(angle) * radius, y, Math.cos(angle) * radius);
    object.rotation.y = angle;
  };
  instance('indexed-calibration-ticks', new THREE.BoxGeometry(1, 0.0008, 1), marking, 96, (index, object) => {
    const major = index % 8 === 0;
    radial(object, index / 96 * Math.PI * 2, major ? 1.431 : 1.445, -0.0088);
    object.scale.set(major ? 0.008 : 0.004, 1, major ? 0.052 : 0.024);
  });
  instance('flush-deck-fasteners', new THREE.CylinderGeometry(0.014, 0.014, 0.0016, 12),
    aluminium, 8, (index, object) => radial(object, (index + 0.5) / 8 * Math.PI * 2, 1.314, DECK_Y + 0.0004));
  instance('fastener-slots', new THREE.BoxGeometry(0.016, 0.0005, 0.0025),
    recess, 8, (index, object) => radial(object, (index + 0.5) / 8 * Math.PI * 2, 1.314, DECK_Y + 0.0014));
  instance('recessed-service-vents', new THREE.BoxGeometry(0.018, 0.018, 0.002),
    recess, 32, (index, object) => {
      const cluster = Math.floor(index / 8);
      const angle = cluster * Math.PI / 2 + (index % 8 - 3.5) * 0.026;
      radial(object, angle, 1.4605, -0.102);
    });
  instance('sage-status-inlays', new THREE.RingGeometry(1.397, 1.408, 12, 1, 0, 0.17),
    signal, 3, (index, object) => {
      object.position.y = -0.0086;
      object.rotation.set(-Math.PI / 2, 0, index * Math.PI * 2 / 3 + 0.3);
    });

  root.add(new THREE.HemisphereLight('#f0f2f5', '#535051', 0.5));
  const key = new THREE.DirectionalLight('#fff2e4', 3.1);
  key.name = 'warm-softbox-key';
  key.position.set(-3.5, 6, 4.5);
  key.target.position.set(0, 1, 0);
  key.castShadow = true;
  const compact = window.matchMedia('(max-width: 768px), (pointer: coarse)').matches;
  const shadowSize = compact ? 1024 : 2048;
  key.shadow.mapSize.set(shadowSize, shadowSize);
  Object.assign(key.shadow.camera, { left: -2.8, right: 2.8, top: 3.4, bottom: -2.8, near: 0.5, far: 16 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.00015;
  key.shadow.normalBias = 0.012;
  key.shadow.radius = 3;
  root.add(key, key.target);
  const fill = new THREE.DirectionalLight('#dce7f5', 1.05);
  fill.name = 'cool-neutral-fill';
  fill.position.set(4, 2.8, 2);
  const rim = new THREE.DirectionalLight('#edf3fa', 2.2);
  rim.name = 'neutral-rim';
  rim.position.set(1, 4.2, -4);
  root.add(fill, rim);

  const grid = new THREE.GridHelper(20, 40, '#8a9299', '#747c83');
  grid.name = 'optional-floor-grid';
  grid.position.y = FLOOR_Y + 0.001;
  const gridMaterial = grid.material as THREE.LineBasicMaterial;
  gridMaterial.transparent = true;
  gridMaterial.opacity = 0.14;
  gridMaterial.depthWrite = false;
  root.add(grid);
  return { root, grid, environment };
}
