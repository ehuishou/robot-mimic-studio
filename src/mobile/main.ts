import './style.css';
import { mountCapturePanel } from './capturePanel';
import { createPoseClient } from '../communication/client';
import type { HelloMessage } from '../communication/protocol';

const params = new URLSearchParams(location.hash.slice(1));
const room = params.get('room'), token = params.get('token');
history.replaceState(null, '', location.pathname + location.search);
let transport: ReturnType<typeof createPoseClient> | undefined;
let activeSessionId: string | undefined;
let relayConnected = false, viewerConnected = false;
let relayStatusText = room && token ? '正在连接中继…' : '';
function updateRelayStatus(text: string): void {
  relayStatusText = text;
  const status = document.getElementById('relay-status');
  if (status) { status.textContent = text; status.hidden = !text; }
}
if (room && token) {
  const hello: HelloMessage = { type: 'hello', version: 1, role: 'mobile', room, token };
  transport = createPoseClient(hello, (state, detail) => {
    relayConnected = state === 'connected';
    updateRelayStatus(detail || (state === 'connected'
      ? viewerConnected ? '电脑已加入 · 姿态仅通过关键点传输' : '中继已连接 · 等待电脑加入'
      : { connecting: '正在连接中继…', disconnected: '中继连接已断开，正在尝试恢复…', error: '中继连接错误' }[state]));
  }, undefined, {
    onPeer: connected => {
      viewerConnected = connected;
      if (relayConnected) updateRelayStatus(connected ? '电脑已加入 · 姿态仅通过关键点传输' : '中继已连接 · 等待电脑加入');
    },
  });
}
const capture = mountCapturePanel(document.getElementById('app')!, {
  onStart: () => {
    activeSessionId = crypto.randomUUID().replaceAll('-', '');
    transport?.setCapture('started', activeSessionId);
  },
  onStop: () => {
    if (activeSessionId) transport?.setCapture('stopped', activeSessionId);
    activeSessionId = undefined;
  },
  onFrame: (frame, timestamp, seq) => transport?.sendPose(frame, timestamp, seq),
});
if (relayStatusText) updateRelayStatus(relayStatusText);
const dispose = () => { capture.dispose(); transport?.dispose(); };
window.addEventListener('pagehide', (event) => { if (!event.persisted) dispose(); });
if (import.meta.hot) import.meta.hot.dispose(dispose);
