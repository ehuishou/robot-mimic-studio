import { renderMobileLayout } from './layout';
import { createCameraControls } from './cameraControls';
import { attachCamera, cameraError, requestCamera, stopStream } from '../pose/camera';
import { drawPose } from '../pose/drawPose';
import type { PoseFrame } from '../pose/poseTypes';
import { summarizePose } from '../pose/poseTypes';
import type { PoseRunner } from '../pose/pose';
export interface CaptureCallbacks {
  onFrame?: (frame: PoseFrame, timestampMs: number, seq: number) => void;
  onStop?: () => void;
  onStart?: () => void;
}
export function mountCapturePanel(container: HTMLElement, callbacks: CaptureCallbacks = {}, embedded = false) {
renderMobileLayout(container, embedded);
const el = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = container.querySelector(`#${id}`);
  if (!node) throw new Error(`缺少页面元素：${id}`);
  return node as T;
};
const video = el<HTMLVideoElement>('camera'), canvas = el<HTMLCanvasElement>('pose-overlay');
const start = el<HTMLButtonElement>('start-camera'), stop = el<HTMLButtonElement>('stop-camera');
const lifetime = new AbortController();
interface Session { abort: AbortController; stream?: MediaStream; runner?: PoseRunner; cancelFrame?: () => void }
let active: Session | undefined;
let disposed = false;
const cameraControls = createCameraControls(() => {
  if (!active || disposed) return;
  stopCapture('正在切换摄像头…');
  void startCapture();
}, container);
function clearMetrics(): void {
  el('pose-fps').textContent = '—'; el('pose-visible').textContent = '0'; el('pose-count').textContent = '0';
  canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
}
function stopCapture(message = '摄像头已停止，画面不会被保存。'): void {
  const session = active;
  active = undefined;
  callbacks.onStop?.();
  session?.abort.abort(); session?.cancelFrame?.();
  if (session?.stream) stopStream(session.stream);
  try { session?.runner?.close(); } catch { /* Tracks and callbacks are already stopped. */ }
  video.pause(); video.srcObject = null;
  clearMetrics(); cameraControls.reset();
  el('standby').hidden = false; el('camera-light').classList.remove('active');
  el('pose-status').textContent = '尚未启动';
  el('load-status').textContent = message;
  start.disabled = disposed; stop.disabled = true;
}
function runFrames(session: Session): void {
  let seq = 0;
  let lastVideoTime = -1, lastInference = -Infinity, sampledAt = performance.now(), count = 0;
  const tick = () => {
    if (active !== session || session.abort.signal.aborted) return;
    try {
      const now = performance.now();
      if (video.readyState >= 2 && video.videoWidth > 0 && video.currentTime !== lastVideoTime && now - lastInference >= 50) {
        lastVideoTime = video.currentTime; lastInference = now;
        const frame = session.runner!.detect(video, now);
        callbacks.onFrame?.(frame, now, ++seq);
        drawPose(canvas, frame, session.runner!.connections, video.videoWidth, video.videoHeight);
        const summary = summarizePose(frame);
        el('pose-status').textContent = summary.status;
        el('pose-count').textContent = String(summary.count); el('pose-visible').textContent = String(summary.visible);
        count++;
        if (now - sampledAt >= 1000) { el('pose-fps').textContent = (count * 1000 / (now - sampledAt)).toFixed(1); sampledAt = now; count = 0; }
      }
      schedule();
    } catch (error) {
      stopCapture('识别已停止，可以重新启动。');
      el('pose-error').textContent = '姿态识别中断：' + cameraError(error); el('pose-error').hidden = false;
    }
  };
  const schedule = () => {
    if (active !== session) return;
    if (typeof video.requestVideoFrameCallback === 'function') {
      const id = video.requestVideoFrameCallback(tick); session.cancelFrame = () => video.cancelVideoFrameCallback(id);
    } else { const id = requestAnimationFrame(tick); session.cancelFrame = () => cancelAnimationFrame(id); }
  };
  schedule();
}
async function startCapture(): Promise<void> {
  if (active || disposed) return;
  el('pose-error').hidden = true;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    el('pose-error').textContent = !window.isSecureContext ? '摄像头需要安全连接。请用 HTTPS 打开本页；局域网 HTTP 地址通常不能使用摄像头。' : '当前浏览器不支持摄像头访问。请使用较新版本的 Safari 或 Chrome。';
    el('pose-error').hidden = false; return;
  }
  const session: Session = { abort: new AbortController() };
  active = session; callbacks.onStart?.(); const signal = session.abort.signal;
  start.disabled = true; stop.disabled = false; clearMetrics();
  const update = (text: string) => { if (active === session) { el('load-status').textContent = text; el('pose-status').textContent = '启动中'; } };
  try {
    update('请允许摄像头权限…');
    const stream = await requestCamera(signal, cameraControls.selection());
    session.stream = stream;
    signal.throwIfAborted();
    stream.getVideoTracks().forEach((track) => track.addEventListener('ended', () => { if (active === session) stopCapture('摄像头连接已断开，请重新启动。'); }, { signal }));
    await attachCamera(video, stream, signal);
    el('standby').hidden = true; el('camera-light').classList.add('active');
    const settings = stream.getVideoTracks()[0]?.getSettings();
    // A rear/external camera should not get a misleading selfie mirror.
    const mirrored = settings?.facingMode === 'user';
    container.querySelector<HTMLElement>('.camera-layer')!.style.transform = mirrored ? 'scaleX(-1)' : 'none';
    el('video-stage').style.aspectRatio = `${video.videoWidth || 640} / ${video.videoHeight || 480}`;
    const syncVideoSize = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) el('video-stage').style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
    };
    video.addEventListener('resize', syncVideoSize, { signal });
    syncVideoSize();
    cameraControls.connect(stream, signal);
    const labels = container.querySelectorAll('.stage-label span');
    labels[0]!.textContent = mirrored ? 'FRONT CAMERA' : settings?.facingMode === 'environment' ? 'REAR CAMERA' : 'CAMERA'; labels[1]!.textContent = mirrored ? '单人 · 镜像预览' : '单人 · 原始预览';
    const { createPoseRunner } = await import('../pose/pose');
    signal.throwIfAborted();
    const runner = await createPoseRunner(signal, update);
    if (signal.aborted || active !== session) { runner.close(); return; }
    session.runner = runner;
    el('pose-status').textContent = '等待人体入镜';
    el('load-status').textContent = '识别运行中 · 画面仅在本机处理';
    runFrames(session);
  } catch (error) {
    if (signal.aborted || active !== session) return;
    stopCapture('启动未完成，请处理提示后重试。');
    el('pose-error').textContent = cameraError(error); el('pose-error').hidden = false;
  }
}
start.addEventListener('click', () => { void startCapture(); }, { signal: lifetime.signal });
stop.addEventListener('click', () => stopCapture(), { signal: lifetime.signal });
document.addEventListener('visibilitychange', () => { if (document.hidden && active) stopCapture('页面进入后台，摄像头已关闭。返回后可重新启动。'); }, { signal: lifetime.signal });
window.addEventListener('pagehide', () => stopCapture(), { signal: lifetime.signal });
function dispose(): void { disposed = true; stopCapture(); lifetime.abort(); cameraControls.dispose(); }
window.addEventListener('pagehide', (event) => { if (!event.persisted) dispose(); }, { signal: lifetime.signal });
return { stop: stopCapture, dispose };
}
