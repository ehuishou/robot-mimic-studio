import type { PoseFrame } from '../pose/poseTypes';
import { isVisible } from '../pose/poseTypes';
import type { ImageMotion, RetargetFrame } from './types';

export function imageMotion(frame: PoseFrame): ImageMotion | undefined {
  const [ls, rs, lh, rh] = [11, 12, 23, 24].map(i => frame.normalizedLandmarks[i]);
  if (![ls, rs, lh, rh].every(isVisible)) return;
  const x = (lh!.x + rh!.x) / 2, y = (lh!.y + rh!.y) / 2;
  const scale = Math.hypot((ls!.x + rs!.x) / 2 - x, (ls!.y + rs!.y) / 2 - y);
  if (x < 0 || x > 1 || y < 0 || y > 1 || scale < 0.04 || scale > 0.8) return;
  return { x, y, scale };
}
export function toRetargetFrame(frame: PoseFrame, timestampMs: number, seq: number): RetargetFrame {
  return { timestampMs, seq, coordinateSpace: 'mediapipe-world', worldLandmarks: frame.worldLandmarks, motion: imageMotion(frame) };
}
