import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Connection, PoseFrame } from './poseTypes';
export interface PoseRunner {
  connections: readonly Connection[];
  detect(video: HTMLVideoElement, timestamp: number): PoseFrame;
  close(): void;
}
export async function createPoseRunner(signal: AbortSignal, update: (text: string) => void): Promise<PoseRunner> {
  const base = import.meta.env.BASE_URL + 'mediapipe/';
  update('正在加载姿态模型…');
  let bytes: Uint8Array;
  try {
    const response = await fetch(base + 'models/pose_landmarker_lite.task', { signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength < 1000000) throw new Error('模型内容不完整');
  } catch (error) {
    signal.throwIfAborted();
    throw new Error('姿态模型加载失败，请检查网络或刷新页面重试。' + (error instanceof Error ? `（${error.message}）` : ''));
  }
  signal.throwIfAborted();
  update('正在初始化识别引擎…');
  let files;
  try { files = await FilesetResolver.forVisionTasks(base + 'wasm'); }
  catch { signal.throwIfAborted(); throw new Error('WASM 运行环境初始化失败，请更新浏览器后重试。'); }
  signal.throwIfAborted();
  let landmarker: PoseLandmarker;
  try {
    landmarker = await PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetBuffer: bytes, delegate: 'CPU' }, runningMode: 'VIDEO', numPoses: 1,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    });
  } catch (error) {
    signal.throwIfAborted();
    throw new Error('识别引擎或 WASM 加载失败，请检查网络并使用较新版本的 Safari / Chrome。' + (error instanceof Error ? `（${error.message}）` : ''));
  }
  if (signal.aborted) { landmarker.close(); signal.throwIfAborted(); }
  let closed = false;
  return {
    connections: PoseLandmarker.POSE_CONNECTIONS,
    detect(video, timestamp) {
      const result = landmarker.detectForVideo(video, timestamp);
      try { return { normalizedLandmarks: result.landmarks?.[0] || [], worldLandmarks: result.worldLandmarks?.[0] || [] }; }
      finally { result.close(); }
    },
    close() { if (!closed) { closed = true; landmarker.close(); } },
  };
}
