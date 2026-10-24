import type { PoseFrame } from '../pose/poseTypes';
import type { HelloMessage, RelayMessage } from './protocol';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

export function createPoseClient(
  hello: HelloMessage,
  onState: (state: ConnectionState, detail?: string) => void,
  onPose?: (pose: RelayMessage & { type: 'pose' }) => void,
) {
  let socket: WebSocket | undefined, disposed = false, attempt = 0, retryTimer = 0;
  const connect = () => {
    if (disposed) return;
    onState(attempt ? 'connecting' : 'connecting');
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${scheme}//${location.host}/ws`);
    socket.addEventListener('open', () => socket?.send(JSON.stringify(hello)));
    socket.addEventListener('message', event => {
      let message: RelayMessage;
      try { message = JSON.parse(String(event.data)); } catch { onState('error', '服务端消息格式错误'); return; }
      if (message.type === 'ready') { attempt = 0; onState('connected'); }
      else if (message.type === 'error') onState('error', message.message);
      else if (message.type === 'pose') onPose?.(message as RelayMessage & { type: 'pose' });
    });
    socket.addEventListener('close', () => {
      if (disposed) return;
      onState('disconnected');
      if (attempt >= 5) { onState('error', '重连次数已用完，请刷新页面重新配对。'); return; }
      const delay = Math.min(800 * 2 ** attempt++, 10_000);
      retryTimer = window.setTimeout(connect, delay);
    });
    socket.addEventListener('error', () => onState('error', '通信连接异常'));
  };
  connect();
  return {
    sendPose(frame: PoseFrame, timestamp: number, seq: number, room: string) {
      if (socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 16_384) return;
      socket.send(JSON.stringify({ type: 'pose', room, timestamp, seq, landmarks: frame.worldLandmarks }));
    },
    dispose() { disposed = true; clearTimeout(retryTimer); socket?.close(1000, 'page closed'); },
  };
}
