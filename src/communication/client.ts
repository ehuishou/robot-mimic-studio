import { imageMotion } from '../retarget/poseAdapter';
import type { PoseFrame } from '../pose/poseTypes';
import { COMMUNICATION_CONFIG } from './config';
import { normalizePoseLandmarks, type CaptureMessage, type HelloMessage, type RelayMessage } from './protocol';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';
export interface PoseClientEvents {
  onPeer?: (connected: boolean) => void;
  onCapture?: (message: Extract<RelayMessage, { type: 'capture' }>) => void;
  onReady?: () => void;
}

export function createPoseClient(
  hello: HelloMessage,
  onState: (state: ConnectionState, detail?: string) => void,
  onPose?: (pose: Extract<RelayMessage, { type: 'pose' }>) => void,
  events: PoseClientEvents = {},
) {
  let socket: WebSocket | undefined;
  let disposed = false;
  let terminal = false;
  let attempt = 0;
  let retryTimer = 0;
  let heartbeatTimer = 0;
  let pendingNonce: number | undefined;
  let pendingSince = 0;
  let nextNonce = 0;
  let captureState: CaptureMessage['state'] | undefined;
  let sessionId: string | undefined;

  const send = (message: unknown, target = socket): boolean => {
    if (target?.readyState !== WebSocket.OPEN || target.bufferedAmount > COMMUNICATION_CONFIG.maxBufferedBytes) return false;
    target.send(JSON.stringify(message));
    return true;
  };
  const stopHeartbeat = () => {
    clearInterval(heartbeatTimer);
    heartbeatTimer = 0;
    pendingNonce = undefined;
  };
  const sendCaptureState = () => {
    if (captureState && sessionId) send({ type: 'capture', version: hello.version, room: hello.room, sessionId, state: captureState });
  };
  const scheduleRetry = () => {
    if (disposed || terminal || retryTimer) return;
    if (attempt >= COMMUNICATION_CONFIG.maxRetries) {
      onState('error', '重连次数已用完，请检查网络或重新配对。');
      return;
    }
    const delay = Math.min(800 * 2 ** attempt++, COMMUNICATION_CONFIG.maxBackoffMs);
    retryTimer = window.setTimeout(() => { retryTimer = 0; connect(); }, delay);
  };
  const connect = () => {
    if (disposed || terminal) return;
    onState('connecting');
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const current = new WebSocket(`${scheme}//${location.host}${COMMUNICATION_CONFIG.wsPath}`);
    socket = current;
    current.addEventListener('open', () => send(hello, current));
    current.addEventListener('message', event => {
      if (disposed || socket !== current) return;
      let message: unknown;
      try { message = JSON.parse(String(event.data)); } catch { onState('error', '服务端消息格式错误'); current.close(4002, 'invalid relay message'); return; }
      if (!message || typeof message !== 'object' || typeof (message as { type?: unknown }).type !== 'string') return;
      const relay = message as RelayMessage;
      if (relay.type === 'ready') {
        attempt = 0;
        onState('connected');
        events.onReady?.();
        sendCaptureState();
        stopHeartbeat();
        heartbeatTimer = window.setInterval(() => {
          if (pendingNonce !== undefined) {
            if (performance.now() - pendingSince >= COMMUNICATION_CONFIG.heartbeatTimeoutMs) current.close(4000, 'heartbeat timeout');
            return;
          }
          const nonce = ++nextNonce;
          if (send({ type: 'ping', version: hello.version, nonce }, current)) {
            pendingNonce = nonce;
            pendingSince = performance.now();
          }
        }, COMMUNICATION_CONFIG.heartbeatIntervalMs);
      } else if (relay.type === 'pong' && relay.nonce === pendingNonce) {
        pendingNonce = undefined;
      } else if (relay.type === 'peer' && typeof relay.connected === 'boolean') {
        events.onPeer?.(relay.connected);
      } else if (relay.type === 'capture' && typeof relay.sessionId === 'string' && (relay.state === 'started' || relay.state === 'stopped')) {
        events.onCapture?.(relay);
      } else if (relay.type === 'pose') {
        onPose?.(relay);
      } else if (relay.type === 'error') {
        onState('error', relay.message);
      }
    });
    current.addEventListener('close', event => {
      stopHeartbeat();
      if (socket === current) socket = undefined;
      if (disposed) return;
      events.onPeer?.(false);
      onState('disconnected');
      if ([4001, 4002, 4003, 4004].includes(event.code)) {
        terminal = true;
        onState('error', event.code === 4003 ? '配对凭据无效或已过期，请重新创建配对。' : event.code === 4004 ? '该配对角色已在其他页面连接。' : '通信协议或配对状态无效，请重新配对。');
        return;
      }
      scheduleRetry();
    });
    current.addEventListener('error', () => { if (!disposed && socket === current) onState('error', '通信连接异常'); });
  };

  connect();
  return {
    sendPose(frame: PoseFrame, timestamp: number, seq: number) {
      if (!sessionId || captureState !== 'started') return false;
      const landmarks = normalizePoseLandmarks(frame.worldLandmarks);
      if (!landmarks) return false;
      const motion = imageMotion(frame);
      return send({ type: 'pose', version: hello.version, room: hello.room, sessionId, timestamp, seq, landmarks, ...(motion ? { motion } : {}) });
    },
    setCapture(state: CaptureMessage['state'], id: string) {
      sessionId = id;
      captureState = state;
      return sendCaptureState();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(retryTimer);
      stopHeartbeat();
      const current = socket;
      socket = undefined;
      current?.close(1000, 'page closed');
    },
  };
}
