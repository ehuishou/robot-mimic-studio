import { isVisible } from './poseTypes';
import type { Connection, PoseFrame } from './poseTypes';
export function drawPose(canvas: HTMLCanvasElement, frame: PoseFrame, connections: readonly Connection[], width: number, height: number): void {
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = Math.max(2, width / 220);
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#9beaac';
  for (const { start, end } of connections) {
    const a = frame.normalizedLandmarks[start], b = frame.normalizedLandmarks[end];
    if (!isVisible(a) || !isVisible(b)) continue;
    ctx.beginPath(); ctx.moveTo(a.x * width, a.y * height); ctx.lineTo(b.x * width, b.y * height); ctx.stroke();
  }
  for (const point of frame.normalizedLandmarks) {
    if (!isVisible(point)) continue;
    ctx.beginPath(); ctx.arc(point.x * width, point.y * height, Math.max(3, width / 140), 0, Math.PI * 2);
    ctx.fillStyle = '#f1fff4'; ctx.fill(); ctx.strokeStyle = '#234e31'; ctx.lineWidth = 1.5; ctx.stroke();
  }
}
