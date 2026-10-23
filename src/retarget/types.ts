import type { PosePoint } from '../pose/poseTypes';

/** World points: metres, hip-centred, camera x-right/y-down/z-away. Never mirrored. */
export interface RetargetFrame {
  timestampMs: number;
  seq: number;
  coordinateSpace: 'mediapipe-world';
  worldLandmarks: readonly PosePoint[];
}
export type ArmSide = 'left' | 'right';
export type FollowState = 'tracking' | 'holding' | 'recovering' | 'rest' | 'paused' | 'disabled';
export interface RigBindingConfig {
  side: ArmSide;
  segment?: 'upperArm' | 'forearm';
  enabled?: boolean;
  /** Actual child indices from model root, stable across loads of the same asset. */
  bonePath: readonly number[];
  endPath: readonly number[];
  expectedBoneName: string;
  expectedEndName: string;
  maxSwingRadians: number;
  /** Per-asset rotation from camera-converted direction to target world axes (xyzw). */
  axisCorrection: readonly [number, number, number, number];
}
export interface ArmDebug {
  side: ArmSide;
  name: string;
  path: string;
  state: FollowState;
  direction: readonly number[] | null;
  target: readonly number[];
  actual: readonly number[];
  errorDegrees: number;
  limited: boolean;
  lastValidMs: number | null;
}
