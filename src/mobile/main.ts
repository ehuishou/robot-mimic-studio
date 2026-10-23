import './style.css';
import { mountCapturePanel } from './capturePanel';
const capture = mountCapturePanel(document.getElementById('app')!);
if (import.meta.hot) import.meta.hot.dispose(capture.dispose);
