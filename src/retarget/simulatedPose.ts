import type { PosePoint } from '../pose/poseTypes';
import type { RetargetFrame } from './types';

export const SIMULATIONS = {
  neutral: '中立姿态', left: '只抬左臂', right: '只抬右臂', both: '双臂外展', forward: '双臂前伸',
  full: '全身动作', walk: '迈步动作', turn: '连续转身', twist: '胸腰扭转', travel: '人物位移', plant: '站立锁脚', loss: '左侧低置信度', missing: '关键点缺失', invalid: '异常坐标', antipode: '向上限位',
} as const;
export type Simulation = keyof typeof SIMULATIONS;

/** A deterministic 33-point world-pose fixture for mapping tests and UI demos. */
export function simulatedPose(mode: Simulation, timestampMs: number, seq: number): RetargetFrame {
  const points: PosePoint[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  const point = (x: number, y: number, z: number, visibility = 1): PosePoint => ({ x, y, z, visibility });
  // MediaPipe world coordinates: x-right, y-down, z-away. Keep mapped landmarks visible in the normal fixtures.
  points[0] = point(0, -0.92, 0);
  points[2] = point(0.04, -0.88, -0.05); points[5] = point(-0.04, -0.88, -0.05);
  points[9] = point(0.025, -0.8, -0.05); points[10] = point(-0.025, -0.8, -0.05);
  points[11] = point(0.2, -0.4, 0); points[12] = point(-0.2, -0.4, 0);
  points[13] = point(0.228, -0.08, 0); points[14] = point(-0.228, -0.08, 0);
  points[15] = point(0.228, 0.24, 0); points[16] = point(-0.228, 0.24, 0);
  points[17] = point(0.228, 0.34, 0); points[18] = point(-0.228, 0.34, 0);
  points[19] = point(0.255, 0.32, 0); points[20] = point(-0.255, 0.32, 0);
  points[23] = point(0.14, 0.35, 0); points[24] = point(-0.14, 0.35, 0);
  points[25] = point(0.14, 0.82, 0); points[26] = point(-0.14, 0.82, 0);
  points[27] = point(0.14, 1.28, 0); points[28] = point(-0.14, 1.28, 0);
  points[31] = point(0.14, 1.28, -0.18); points[32] = point(-0.14, 1.28, -0.18);

  if (mode === 'left' || mode === 'both' || mode === 'loss') points[13] = point(0.52, -0.4, 0, mode === 'loss' ? 0.1 : 1);
  if (mode === 'right' || mode === 'both') points[14] = point(-0.52, -0.4, 0);
  if (mode === 'forward') { points[13] = point(0.2, -0.4, -0.32); points[14] = point(-0.2, -0.4, -0.32); }
  if (mode === 'antipode') { points[13] = point(0.2, -0.72, 0); points[14] = point(-0.2, -0.72, 0); }
  // Preserve a coherent elbow/wrist/hand chain when demonstrating an isolated arm swing.
  if (['left', 'right', 'both', 'loss', 'forward', 'antipode'].includes(mode)) {
    for (const side of [0, 1]) {
      const shoulder = points[11 + side]!, elbow = points[13 + side]!;
      const dx = elbow.x - shoulder.x, dy = elbow.y - shoulder.y, dz = elbow.z - shoulder.z;
      points[15 + side] = point(elbow.x + dx, elbow.y + dy, elbow.z + dz);
      const wrist = points[15 + side]!;
      points[17 + side] = point(wrist.x + dx * 0.3, wrist.y + dy * 0.3, wrist.z + dz * 0.3);
      points[19 + side] = point(wrist.x + dx * 0.28, wrist.y + dy * 0.28, wrist.z + dz * 0.28);
    }
  }
  if (mode === 'full' || mode === 'walk') {
    // Shoulder line tilts and both arms bend in distinct directions.
    points[11] = point(0.23, -0.38, 0.06); points[12] = point(-0.18, -0.43, -0.04);
    points[13] = point(0.46, -0.18, -0.12); points[14] = point(-0.42, -0.1, 0.16);
    points[15] = point(0.58, 0.08, -0.16); points[16] = point(-0.48, 0.18, 0.24);
    points[17] = point(0.58, 0.18, -0.16); points[18] = point(-0.48, 0.28, 0.24);
    points[19] = point(0.61, 0.17, -0.16); points[20] = point(-0.51, 0.27, 0.24);
    points[0] = point(0.02, -0.96, -0.12);
    points[23] = point(0.17, 0.35, 0.04); points[24] = point(-0.1, 0.39, -0.02);
    points[25] = point(0.28, 0.8, -0.18); points[26] = point(-0.24, 0.83, 0.18);
    points[27] = point(0.2, 1.23, -0.25); points[28] = point(-0.32, 1.18, 0.28);
    points[31] = point(0.2, 1.33, -0.42); points[32] = point(-0.32, 1.28, 0.1);
    if (mode === 'walk') {
      points[25] = point(0.38, 0.74, -0.1); points[27] = point(0.54, 1.08, -0.02); points[31] = point(0.63, 1.1, -0.22);
      points[26] = point(-0.18, 0.9, 0.03); points[28] = point(-0.12, 1.36, 0.18); points[32] = point(-0.08, 1.42, -0.02);
    }
  }
  const phase = timestampMs / 1000;
  if (mode === 'turn' || mode === 'twist') {
    const angle = mode === 'turn' ? phase * Math.PI / 4 : Math.sin(phase) * 0.8;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    for (const [index, p] of points.entries()) {
      if (mode === 'twist' && index >= 23) continue;
      const x = p.x;
      p.x = cos * x - sin * p.z; p.z = sin * x + cos * p.z;
    }
  }
  const motion = mode === 'travel' ? { x: 0.5 + Math.sin(phase * 0.6) * 0.08, y: 0.6, scale: 0.25 + Math.sin(phase * 0.35) * 0.015 }
    : mode === 'plant' ? { x: 0.5 + Math.sin(phase) * 0.003, y: 0.6, scale: 0.25 } : undefined;
  if (mode === 'invalid') points[13] = point(NaN, Infinity, 0);
  return { timestampMs, seq, coordinateSpace: 'mediapipe-world', motion, worldLandmarks: mode === 'missing' ? [] : points };
}
