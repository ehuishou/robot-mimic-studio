import type { BodySegment, BodySide } from './types';

export interface LandmarkSource {
  side: BodySide;
  segment: BodySegment;
  start: readonly number[];
  end: readonly number[];
}

/** MediaPipe Pose World Landmark indices. Midpoints are represented by two-index endpoints. */
export function sourceFor(side: BodySide, segment: BodySegment): LandmarkSource {
  if (segment === 'torso') return { side: 'center', segment, start: [23, 24], end: [11, 12] };
  if (segment === 'neck') return { side: 'center', segment, start: [11, 12], end: [0] };
  if (side === 'center') throw new Error(`${segment} mapping must specify left or right.`);
  const left = side === 'left';
  const points: Record<Exclude<BodySegment, 'torso' | 'neck'>, readonly [number[], number[]]> = {
    upperArm: left ? [[11], [13]] : [[12], [14]],
    forearm: left ? [[13], [15]] : [[14], [16]],
    hand: left ? [[15], [17, 19]] : [[16], [18, 20]],
    upperLeg: left ? [[23], [25]] : [[24], [26]],
    lowerLeg: left ? [[25], [27]] : [[26], [28]],
    foot: left ? [[27], [31]] : [[28], [32]],
  };
  const [start, end] = points[segment];
  return { side, segment, start, end };
}

export const BODY_SEGMENTS: readonly BodySegment[] = ['torso', 'neck', 'upperArm', 'forearm', 'hand', 'upperLeg', 'lowerLeg', 'foot'];
