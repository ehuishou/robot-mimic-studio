import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** Authored procedural rig. These names describe our own bones, never an assumed GLB rig. */
export function createFallbackRobot(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'Studio / Procedural Robot';
  const shell = new THREE.MeshStandardMaterial({ color: '#e3e8dc', roughness: 0.33, metalness: 0.28 });
  const dark = new THREE.MeshStandardMaterial({ color: '#252f2c', roughness: 0.48, metalness: 0.5 });
  const accent = new THREE.MeshStandardMaterial({ color: '#b7eb7f', roughness: 0.3, metalness: 0.25 });
  const glow = new THREE.MeshStandardMaterial({ color: '#c8ffa4', emissive: '#9adf68', emissiveIntensity: 1.8 });
  const visor = new THREE.MeshStandardMaterial({ color: '#101f1a', roughness: 0.17, metalness: 0.65 });
  const box = (parent: THREE.Object3D, size: [number, number, number], at: [number, number, number], material = shell, radius = 0.055) => {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(...size, 3, radius), material);
    mesh.position.set(...at);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const joint = (parent: THREE.Object3D, radius: number) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 12), dark);
    mesh.castShadow = true;
    parent.add(mesh);
  };
  const bone = (name: string, parent: THREE.Object3D, at: [number, number, number]) => {
    const value = new THREE.Bone();
    value.name = name;
    value.position.set(...at);
    parent.add(value);
    return value;
  };
  const hips = bone('Hips', root, [0, 1.13, 0]);
  box(hips, [0.48, 0.24, 0.3], [0, 0, 0], dark);
  box(hips, [0.38, 0.11, 0.325], [0, 0.035, 0], shell, 0.03);
  const spine = bone('Spine', hips, [0, 0.18, 0]);
  box(spine, [0.3, 0.25, 0.25], [0, 0.065, 0], dark);
  const chest = bone('Chest', spine, [0, 0.18, 0]);
  box(chest, [0.67, 0.46, 0.35], [0, 0.13, 0]);
  box(chest, [0.49, 0.22, 0.035], [0, 0.19, 0.18], dark, 0.03);
  box(chest, [0.18, 0.024, 0.022], [-0.09, 0.22, 0.205], glow, 0.008);
  box(chest, [0.055, 0.024, 0.022], [0.075, 0.22, 0.205], accent, 0.008);
  const neck = bone('Neck', chest, [0, 0.41, 0]);
  joint(neck, 0.095);
  const head = bone('Head', neck, [0, 0.12, 0]);
  box(head, [0.46, 0.38, 0.36], [0, 0.1, 0], shell, 0.095);
  box(head, [0.365, 0.15, 0.05], [0, 0.12, 0.17], visor, 0.04);
  box(head, [0.09, 0.025, 0.024], [-0.095, 0.125, 0.2], glow, 0.009);
  box(head, [0.09, 0.025, 0.024], [0.095, 0.125, 0.2], glow, 0.009);
  box(head, [0.13, 0.022, 0.018], [0, -0.015, 0.18], dark, 0.008);
  for (const side of [-1, 1]) {
    const label = side > 0 ? 'Left' : 'Right';
    const arm = bone(`${label}UpperArm`, chest, [side * 0.43, 0.24, 0]);
    joint(arm, 0.13);
    box(arm, [0.23, 0.33, 0.25], [side * 0.025, -0.19, 0]);
    box(arm, [0.24, 0.08, 0.27], [side * 0.025, -0.09, 0], accent, 0.025);
    const forearm = bone(`${label}Forearm`, arm, [side * 0.035, -0.4, 0]);
    joint(forearm, 0.095);
    box(forearm, [0.21, 0.31, 0.235], [0, -0.19, 0]);
    const hand = bone(`${label}Hand`, forearm, [0, -0.4, 0]);
    joint(hand, 0.07);
    box(hand, [0.19, 0.19, 0.22], [0, -0.085, 0.015], dark, 0.045);
    const thigh = bone(`${label}UpperLeg`, hips, [side * 0.17, -0.13, 0]);
    joint(thigh, 0.115);
    box(thigh, [0.26, 0.37, 0.28], [0, -0.23, 0]);
    const shin = bone(`${label}LowerLeg`, thigh, [0, -0.47, 0]);
    joint(shin, 0.105);
    box(shin, [0.245, 0.33, 0.27], [0, -0.205, 0]);
    box(shin, [0.14, 0.08, 0.04], [0, -0.06, 0.15], accent, 0.02);
    const foot = bone(`${label}Foot`, shin, [0, -0.4, 0]);
    joint(foot, 0.075);
    box(foot, [0.29, 0.15, 0.43], [0, -0.065, 0.09], dark, 0.045);
    box(foot, [0.295, 0.045, 0.435], [0, -0.12, 0.09], shell, 0.015);
  }
  return root;
}
