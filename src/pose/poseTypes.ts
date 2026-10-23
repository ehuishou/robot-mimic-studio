export interface PosePoint { x: number; y: number; z: number; visibility: number }
export interface PoseFrame {
  normalizedLandmarks: readonly PosePoint[];
  worldLandmarks: readonly PosePoint[];
}
export type Connection = { start: number; end: number };
export const VISIBILITY_THRESHOLD = 0.5;
export function isVisible(point: PosePoint | undefined): point is PosePoint {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
    && Number.isFinite(point.visibility) && point.visibility >= VISIBILITY_THRESHOLD;
}
export function summarizePose(frame: PoseFrame): { count: number; visible: number; status: string } {
  const count = frame.normalizedLandmarks.length;
  const visible = frame.normalizedLandmarks.filter(isVisible).length;
  return { count, visible, status: !count ? '等待人体入镜' : visible < 15 ? '部分关键点不清晰' : '已识别人体' };
}
