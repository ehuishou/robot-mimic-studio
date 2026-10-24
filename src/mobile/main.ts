import './style.css';
import { mountCapturePanel } from './capturePanel';
import { createPoseClient } from '../communication/client';
import type { HelloMessage } from '../communication/protocol';

const params = new URLSearchParams(location.hash.slice(1));
const room = params.get('room'), token = params.get('token');
history.replaceState(null, '', location.pathname + location.search);
let transport: ReturnType<typeof createPoseClient> | undefined;
if (room && token) {
  const hello: HelloMessage = { type: 'hello', role: 'mobile', room, token };
  transport = createPoseClient(hello, (state, detail) => {
    const status = document.getElementById('load-status');
    if (status) status.textContent = detail || ({ connecting: '正在连接电脑…', connected: '已连接电脑 · 姿态仅通过关键点传输', disconnected: '连接已断开，正在尝试恢复…', error: '连接错误' }[state]);
  });
}
const capture = mountCapturePanel(document.getElementById('app')!, {
  onFrame: (frame, timestamp, seq) => transport?.sendPose(frame, timestamp, seq, room || ''),
});
const dispose = () => { capture.dispose(); transport?.dispose(); };
window.addEventListener('pagehide', (event) => { if (!event.persisted) dispose(); });
if (import.meta.hot) import.meta.hot.dispose(dispose);
