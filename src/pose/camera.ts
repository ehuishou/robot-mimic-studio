export function stopStream(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop());
}
export interface CameraSelection { facing?: 'user' | 'environment'; deviceId?: string }
export interface ZoomRange { min: number; max: number; step: number; value: number }
type CameraSettings = MediaTrackSettings & { zoom?: number };
export function cameraZoom(track: MediaStreamTrack): ZoomRange | undefined {
  try {
    const range = (track.getCapabilities?.() as MediaTrackCapabilities & { zoom?: { min?: number; max?: number; step?: number } })?.zoom;
    if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min! <= 0 || range.max! <= range.min!) return;
    const min = range.min!, max = range.max!;
    const step = Number.isFinite(range.step) && range.step! > 0 ? range.step! : 0;
    const current = (track.getSettings() as CameraSettings).zoom;
    if (!Number.isFinite(current)) return;
    return { min, max, step, value: Math.min(max, Math.max(min, current!)) };
  } catch { return; }
}
export function normalizeZoom(value: number, range: ZoomRange): number {
  const bounded = Math.min(range.max, Math.max(range.min, Number.isFinite(value) ? value : range.value));
  return Math.min(range.max, Math.max(range.min, range.step ? Number((range.min + Math.round((bounded - range.min) / range.step) * range.step).toFixed(8)) : bounded));
}
export async function applyCameraZoom(track: MediaStreamTrack, value: number): Promise<number | undefined> {
  // Zoom is an Image Capture extension and is not present in every lib.dom version.
  await track.applyConstraints({ advanced: [{ zoom: value } as MediaTrackConstraintSet] });
  const actual = (track.getSettings() as CameraSettings).zoom;
  return Number.isFinite(actual) ? actual : undefined;
}
export async function requestCamera(
  signal: AbortSignal,
  selection: CameraSelection = {},
  acquire: (constraints: MediaStreamConstraints) => Promise<MediaStream> = (constraints) => navigator.mediaDevices.getUserMedia(constraints),
): Promise<MediaStream> {
  signal.throwIfAborted();
  const source = selection.deviceId ? { deviceId: { exact: selection.deviceId } } : { facingMode: { ideal: selection.facing || 'environment' } };
  const stream = await acquire({ audio: false, video: { ...source, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } } });
  if (signal.aborted) { stopStream(stream); signal.throwIfAborted(); }
  return stream;
}
export async function attachCamera(video: HTMLVideoElement, stream: MediaStream, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  video.srcObject = stream;
  const started = video.play();
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timeout); signal.removeEventListener('abort', aborted); };
    const aborted = () => { cleanup(); reject(signal.reason); };
    const timeout = setTimeout(() => { cleanup(); reject(new Error('视频启动超时，请确认摄像头可用后重试。')); }, 20000);
    signal.addEventListener('abort', aborted, { once: true });
    started.then(() => { cleanup(); resolve(); }, (error: unknown) => { cleanup(); reject(error); });
  });
  signal.throwIfAborted();
}
export function cameraError(error: unknown): string {
  const name = error instanceof Error || error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return '摄像头权限被拒绝。请在浏览器的网站设置中允许摄像头，然后重新启动。';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return '没有找到摄像头。请确认设备支持摄像头，并在系统设置中启用。';
  if (name === 'NotReadableError' || name === 'TrackStartError') return '摄像头无法读取，可能被其他应用占用。请关闭其他摄像应用后重试。';
  if (name === 'SecurityError') return '浏览器阻止了摄像头。请使用可信的 HTTPS 页面，并检查系统权限。';
  if (name === 'OverconstrainedError') return '摄像头不支持请求的设置，请换一个浏览器重试。';
  return error instanceof Error ? error.message : '启动失败，请检查摄像头和网络连接后重试。';
}
