import { applyCameraZoom, cameraZoom, normalizeZoom } from '../pose/camera';
import type { CameraSelection } from '../pose/camera';

export function createCameraControls(onSelectionChange: () => void) {
  const facing = document.getElementById('camera-facing') as HTMLSelectElement;
  const devices = document.getElementById('camera-device') as HTMLSelectElement;
  const zoom = document.getElementById('camera-zoom') as HTMLInputElement;
  const value = document.getElementById('zoom-value') as HTMLOutputElement;
  const hint = document.getElementById('zoom-hint')!;
  const detail = document.getElementById('camera-detail')!;
  const lifetime = new AbortController();
  const label = () => facing.value === 'user' ? '自动选择前置' : '自动选择后置';
  const format = (number: number) => `${Number(number.toFixed(2))}×`;
  const selection = (): CameraSelection => ({ facing: facing.value === 'user' ? 'user' : 'environment', deviceId: devices.value || undefined });
  const reset = () => {
    zoom.disabled = true; zoom.min = '1'; zoom.max = '1'; zoom.value = '1'; value.textContent = '—';
    hint.textContent = '启动后检测可用镜头及变焦范围。';
    detail.textContent = '优先使用所选摄像头 · 请求 1280 × 720，实际以设备为准';
  };
  facing.addEventListener('change', () => {
    devices.value = ''; devices.options[0]!.text = label(); onSelectionChange();
  }, { signal: lifetime.signal });
  devices.addEventListener('change', onSelectionChange, { signal: lifetime.signal });
  function connect(stream: MediaStream, signal: AbortSignal) {
    const track = stream.getVideoTracks()[0];
    if (!track || signal.aborted) return;
    const settings = track.getSettings();
    if (settings.facingMode === 'user' || settings.facingMode === 'environment') facing.value = settings.facingMode;
    detail.textContent = `${track.label || '当前摄像头'} · ${settings.width || '—'} × ${settings.height || '—'}`;
    const refreshDevices = async () => {
      try {
        const list = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput' && device.deviceId);
        if (signal.aborted) return;
        const selected = devices.value;
        devices.replaceChildren(new Option(label(), ''));
        list.forEach((device, index) => devices.add(new Option(device.label || `摄像头 ${index + 1}`, device.deviceId)));
        if (list.some((device) => device.deviceId === selected)) devices.value = selected;
        devices.disabled = list.length < 2;
      } catch { if (!signal.aborted) devices.disabled = true; }
    };
    void refreshDevices();
    navigator.mediaDevices.addEventListener?.('devicechange', refreshDevices, { signal });
    const range = cameraZoom(track);
    if (!range) {
      hint.textContent = '当前镜头或浏览器未开放变焦。可切换镜头，或调整与人物的距离。';
      return;
    }
    zoom.min = String(range.min); zoom.max = String(range.max); zoom.step = range.step ? String(range.step) : 'any';
    zoom.value = String(range.value); value.textContent = format(range.value); zoom.disabled = false;
    const readyHint = `可调范围 ${format(range.min)}–${format(range.max)}，实际效果由设备决定；请保持全身入镜。`;
    hint.textContent = readyHint;
    let pending: number | undefined, applying = false, applied = range.value;
    async function flushZoom() {
      if (applying) return;
      applying = true;
      try {
        while (!signal.aborted && pending !== undefined) {
          const target = pending; pending = undefined;
          try {
            const actual = await applyCameraZoom(track, target);
            if (signal.aborted) return;
            if (actual === undefined) {
              pending = undefined; zoom.disabled = true; zoom.value = String(applied); value.textContent = '—';
              hint.textContent = '浏览器未返回实际变焦倍率，请切换镜头或调整拍摄距离。'; return;
            }
            applied = actual;
            if (pending === undefined) { zoom.value = String(applied); value.textContent = format(applied); }
            hint.textContent = readyHint;
          } catch {
            if (signal.aborted) return;
            if (pending === undefined) { zoom.value = String(applied); value.textContent = format(applied); }
            hint.textContent = '变焦调整未成功，已保留上次倍率。可以重试或切换镜头。';
          }
        }
      } finally { applying = false; }
    }
    zoom.addEventListener('input', () => {
      pending = normalizeZoom(Number(zoom.value), range);
      value.textContent = `${format(pending)} · 调整中`;
      void flushZoom();
    }, { signal });
  }
  return { selection, connect, reset, dispose: () => lifetime.abort() };
}
