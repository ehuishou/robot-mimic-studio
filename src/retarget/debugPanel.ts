import type { RetargetFrame, ArmDebug } from './types';
const labels: Record<string, string> = { tracking: '跟踪中', holding: '短暂保持', recovering: '平滑回中', rest: '中立', paused: '已暂停', disabled: '已停用' };
const format = (values: readonly number[] | null) => values ? values.map(v => Number.isFinite(v) ? v.toFixed(3) : '无效').join(', ') : '—';
export function renderDebug(container: HTMLElement, arms: ArmDebug[], frame?: RetargetFrame): void {
  container.replaceChildren();
  for (const arm of arms) {
    const card = document.createElement('div'); card.className = 'arm-debug'; card.dataset.side = arm.side;
    card.dataset.actual = JSON.stringify(arm.actual); card.dataset.target = JSON.stringify(arm.target); card.dataset.state = arm.state;
    const title = document.createElement('strong'); title.textContent = `${arm.side === 'left' ? '左臂' : '右臂'} · ${arm.name}`;
    const state = document.createElement('span'); state.className = 'state'; state.textContent = `${labels[arm.state]}${arm.limited ? ' · 已限位' : ''}`;
    const detail = document.createElement('pre');
    detail.textContent = `路径 ${arm.path}\n方向  ${format(arm.direction)}\n目标  ${format(arm.target)}\n当前  ${format(arm.actual)}\n角差  ${arm.errorDegrees.toFixed(2)}°`;
    card.append(title, state, detail); container.append(card);
  }
  const points = document.createElement('pre'); points.id = 'point-debug';
  points.textContent = frame ? `世界坐标 · 米 · 帧 ${frame.seq}\n时间 ${frame.timestampMs.toFixed(0)} ms\n` +
    [11, 12, 13, 14, 15, 16].map(index => {
      const p = frame.worldLandmarks[index];
      return p ? `${index}: (${format([p.x, p.y, p.z])}) 置信度 ${Number.isFinite(p.visibility) ? p.visibility.toFixed(2) : '无效'}` : `${index}: 缺失`;
    }).join('\n') : '等待输入世界坐标。';
  container.append(points);
}
