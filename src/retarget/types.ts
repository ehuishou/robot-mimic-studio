import type { PosePoint } from '../pose/poseTypes';

/** World points: metres, hip-centred, camera x-right/y-down/z-away. Never mirrored. */
export interface RetargetFrame {
  timestampMs: number;
  seq: number;
  coordinateSpace: 'mediapipe-world';
  worldLandmarks: readonly PosePoint[];
}
export type ArmSide = 'left' | 'right';
export type BodySide = ArmSide | 'center';
export type BodySegment = 'torso' | 'neck' | 'upperArm' | 'forearm' | 'hand' | 'upperLeg' | 'lowerLeg' | 'foot';
export type FollowState = 'tracking' | 'holding' | 'recovering' | 'rest' | 'paused' | 'disabled';
export interface RigBindingConfig {
  side: BodySide;
  segment: BodySegment;
  enabled?: boolean;
  /** MediaPipe pose landmark indices; multi-point endpoints are averaged for virtual joints. */
  sourceStart: readonly number[];
  sourceEnd: readonly number[];
  /** Actual child indices from model root, stable across loads of the same asset. */
  bonePath: readonly number[];
  /** A direct child bone supplies the rest reference direction when present. */
  endPath?: readonly number[];
  expectedBoneName: string;
  expectedEndName?: string;
  /** Local reference vector for terminal bones (e.g. hand and foot) without a child joint. */
  referenceDirection?: readonly [number, number, number];
  maxSwingRadians: number;
  /** Per-asset rotation from camera-converted direction to target world axes (xyzw). */
  axisCorrection: readonly [number, number, number, number];
}
export interface BindingDebug {
  side: BodySide;
  segment: BodySegment;
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
