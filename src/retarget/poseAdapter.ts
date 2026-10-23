import type { PoseFrame } from '../pose/poseTypes';
import type { RetargetFrame } from './types';

export function toRetargetFrame(frame: PoseFrame, timestampMs: number, seq: number): RetargetFrame {
  return { timestampMs, seq, coordinateSpace: 'mediapipe-world', worldLandmarks: frame.worldLandmarks };
}
