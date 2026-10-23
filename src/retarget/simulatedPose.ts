import type { PosePoint } from '../pose/poseTypes';
import type { RetargetFrame } from './types';
export const SIMULATIONS = { neutral: '中立姿态', left: '只抬左臂', right: '只抬右臂', both: '双臂外展', forward: '双臂前伸', loss: '左臂低置信度', missing: '关键点缺失', invalid: '异常坐标', antipode: '向上限位' } as const;
export type Simulation = keyof typeof SIMULATIONS;
export function simulatedPose(mode: Simulation, timestampMs: number, seq: number): RetargetFrame {
  const points: PosePoint[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  const point = (x: number, y: number, z: number, visibility = 1): PosePoint => ({ x, y, z, visibility });
  points[11] = point(0.2, -0.4, 0); points[12] = point(-0.2, -0.4, 0);
  points[13] = point(0.228, -0.08, 0); points[14] = point(-0.228, -0.08, 0);
  points[15] = point(0.228, 0.24, 0); points[16] = point(-0.228, 0.24, 0);
  if (mode === 'left' || mode === 'both' || mode === 'loss') points[13] = point(0.52, -0.4, 0, mode === 'loss' ? 0.1 : 1);
  if (mode === 'right' || mode === 'both') points[14] = point(-0.52, -0.4, 0);
  if (mode === 'forward') { points[13] = point(0.2, -0.4, -0.32); points[14] = point(-0.2, -0.4, -0.32); }
  if (mode === 'antipode') { points[13] = point(0.2, -0.72, 0); points[14] = point(-0.2, -0.72, 0); }
  if (mode === 'invalid') points[13] = point(NaN, Infinity, 0);
  return { timestampMs, seq, coordinateSpace: 'mediapipe-world', worldLandmarks: mode === 'missing' ? [] : points };
}
