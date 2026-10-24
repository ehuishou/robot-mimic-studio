import type { RetargetFrame, BindingDebug } from './types';

const labels: Record<string, string> = { tracking: '跟踪中', holding: '短暂保持', recovering: '平滑回中', rest: '中立', paused: '已暂停', disabled: '已停用' };
const segmentLabels: Record<string, string> = { torso: '躯干', neck: '头颈', upperArm: '上臂', forearm: '前臂', hand: '手', upperLeg: '大腿', lowerLeg: '小腿', foot: '脚' };
const sideLabels: Record<string, string> = { left: '左', right: '右', center: '中' };
const format = (values: readonly number[] | null) => values ? values.map(v => Number.isFinite(v) ? v.toFixed(3) : '无效').join(', ') : '—';

export function renderDebug(container: HTMLElement, bindings: BindingDebug[], frame?: RetargetFrame): void {
  container.replaceChildren();
  for (const binding of bindings) {
    const card = document.createElement('div');
    card.className = binding.segment === 'upperArm' ? 'arm-debug binding-debug' : 'binding-debug';
    card.dataset.side = binding.side; card.dataset.segment = binding.segment;
    card.dataset.path = binding.path; card.dataset.actual = JSON.stringify(binding.actual); card.dataset.target = JSON.stringify(binding.target); card.dataset.state = binding.state;
    const title = document.createElement('strong'); title.textContent = `${sideLabels[binding.side]}${segmentLabels[binding.segment]} · ${binding.name}`;
    const state = document.createElement('span'); state.className = 'state'; state.textContent = `${labels[binding.state]}${binding.limited ? ' · 已限位' : ''}`;
    const detail = document.createElement('pre');
    detail.textContent = `路径 ${binding.path}\n方向  ${format(binding.direction)}\n目标  ${format(binding.target)}\n当前  ${format(binding.actual)}\n角差  ${binding.errorDegrees.toFixed(2)}°`;
    card.append(title, state, detail); container.append(card);
  }
  const points = document.createElement('pre'); points.id = 'point-debug';
  const indices = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 31, 32];
  points.textContent = frame ? `世界坐标 · 米 · 帧 ${frame.seq}\n时间 ${frame.timestampMs.toFixed(0)} ms\n` +
    indices.map(index => {
      const p = frame.worldLandmarks[index];
      return p ? `${index}: (${format([p.x, p.y, p.z])}) 置信度 ${Number.isFinite(p.visibility) ? p.visibility.toFixed(2) : '无效'}` : `${index}: 缺失`;
    }).join('\n') : '等待输入世界坐标。';
  container.append(points);
}
