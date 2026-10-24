import './style.css';
import { StudioScene } from './scene/StudioScene';
import { loadRobot } from './robot/model';
import type { RobotModel } from './robot/model';
import { resetBones, rotateBone } from './robot/bones';
import type { BoneEntry } from './robot/bones';
import { renderLayout } from './ui/layout';
import { icon } from './ui/icons';
import { mountPresentation } from './ui/presentation';

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`缺少界面元素：${id}`);
  return result as T;
}

renderLayout(element('app'));
const lifetime = new AbortController();
mountPresentation(element('robot-presentation'), element('presentation-controls'), lifetime.signal);
let scene: StudioScene | undefined;
let model: RobotModel | undefined;
let selected: BoneEntry | undefined;
let destroyed = false;

const showError = (message: string) => {
  element('scene-error').textContent = message;
  element('scene-error').hidden = false;
  element('loading').hidden = true;
};

function syncRotation(): void {
  element('selected-name').textContent = selected?.name || '未选择';
  element<HTMLFieldSetElement>('rotation-controls').disabled = !selected;
  (['x', 'y', 'z'] as const).forEach((axis, index) => {
    const value = selected?.offset[index] || 0;
    element<HTMLInputElement>(`rotation-${axis}`).value = String(value);
    element(`value-${axis}`).textContent = `${value}°`;
  });
}

function renderBoneList(): void {
  const list = element('bone-list');
  const query = element<HTMLInputElement>('bone-search').value.trim().toLocaleLowerCase();
  list.replaceChildren();
  const bones = model?.bones.filter((entry) => entry.name.toLocaleLowerCase().includes(query)) || [];
  if (!bones.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = query ? '没有匹配的骨骼' : '模型没有骨骼，可浏览模型但无法调整关节。';
    list.append(empty);
    return;
  }
  for (const entry of bones) {
    const button = document.createElement('button');
    button.className = `bone-item${selected === entry ? ' selected' : ''}`;
    button.type = 'button';
    button.dataset.boneId = entry.id;
    button.style.setProperty('--depth', String(entry.depth));
    button.setAttribute('aria-pressed', String(selected === entry));
    button.title = entry.name;
    const marker = document.createElement('span');
    marker.className = 'bone-marker';
    marker.innerHTML = icon('bone');
    const name = document.createElement('span');
    name.className = 'bone-name';
    name.textContent = entry.name;
    const indicator = document.createElement('span');
    indicator.className = 'bone-indicator';
    indicator.innerHTML = icon('chevron');
    button.append(marker, name, indicator);
    list.append(button);
  }
}

function selectBone(entry: BoneEntry): void {
  selected = entry;
  scene?.selectBone(entry.bone);
  syncRotation();
  // Keep the current focused button and list scroll position intact.
  element('bone-list').querySelectorAll<HTMLButtonElement>('.bone-item').forEach((button) => {
    const active = button.dataset.boneId === entry.id;
    button.classList.toggle('selected', active);
    button.setAttribute('aria-pressed', String(active));
    if (active) {
      const list = element('bone-list');
      const itemBounds = button.getBoundingClientRect();
      const listBounds = list.getBoundingClientRect();
      if (itemBounds.bottom > listBounds.bottom) list.scrollTop += itemBounds.bottom - listBounds.bottom;
      else if (itemBounds.top < listBounds.top) list.scrollTop -= listBounds.top - itemBounds.top;
    }
  });
  element('action-status').textContent = '拖动滑块，调整选中骨骼的局部旋转。';
}

function bindEvents(): void {
  const options = { signal: lifetime.signal };
  element('bone-search').addEventListener('input', renderBoneList, options);
  element('bone-list').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-bone-id]');
    const entry = model?.bones.find((value) => value.id === button?.dataset.boneId);
    if (entry) selectBone(entry);
  }, options);
  for (const axis of ['x', 'y', 'z']) {
    const slider = element<HTMLInputElement>(`rotation-${axis}`);
    slider.addEventListener('input', () => {
      if (!selected) return;
      rotateBone(selected, Number(slider.dataset.axis) as 0 | 1 | 2, Number(slider.value));
      syncRotation();
      element('action-status').textContent = '姿态已调整，可随时重置。';
    }, options);
  }
  element('reset-pose').addEventListener('click', () => {
    if (!model) return;
    resetBones(model.bones);
    model.root.updateMatrixWorld(true);
    syncRotation();
    element('action-status').textContent = '全部骨骼已恢复初始姿势。';
  }, options);
  const toggle = (id: string, callback: (enabled: boolean) => void) => {
    const button = element<HTMLButtonElement>(id);
    button.addEventListener('click', () => {
      const enabled = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(enabled));
      button.classList.toggle('active', enabled);
      callback(enabled);
    }, options);
  };
  toggle('toggle-grid', (enabled) => scene?.setGrid(enabled));
  toggle('toggle-skeleton', (enabled) => scene?.setSkeleton(enabled));
  toggle('toggle-rotate', (enabled) => scene?.setAutoRotate(enabled));
  const setView = (view: 'perspective' | 'front' | 'side') => {
    scene?.resetCamera(view);
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  };
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.view as 'perspective' | 'front' | 'side'), options);
  });
  element('reset-camera').addEventListener('click', () => setView('perspective'), options);
  // Keep resources alive for bfcache; dispose when leaving for good or during HMR.
  window.addEventListener('pagehide', (event) => { if (!event.persisted) dispose(); }, options);
}

async function initialize(): Promise<void> {
  try {
    scene = new StudioScene(element('viewport'), (fps) => { element('fps').textContent = String(fps); }, showError);
    bindEvents();
    model = await loadRobot(lifetime.signal);
    if (destroyed) return;
    scene.addModel(model.root);
    const fallback = model.source === 'fallback';
    element('source-badge').textContent = fallback ? '内置几何体模型' : 'GLB 模型';
    element('model-label').textContent = fallback ? 'UNIT–01 / STUDIO ROBOT' : 'ROBOT / CUSTOM MODEL';
    element('model-subtitle').textContent = fallback ? '程序化骨骼 · 随时准备探索' : '模型已居中 · 保留原始骨骼层级';
    element('file-name').textContent = fallback ? 'Studio Robot' : 'robot.glb';
    element('file-detail').textContent = fallback ? '内置备用模型 / Procedural' : 'public/models/robot.glb';
    element('model-ready').hidden = false;
    element('bone-count').textContent = String(model.bones.length).padStart(2, '0');
    element('bone-total').textContent = String(model.bones.length);
    element('mesh-count').textContent = String(model.meshCount).padStart(2, '0');
    element('loading').hidden = true;
    const notice = element('model-notice').querySelector('span')!;
    notice.textContent = model.notice || 'GLB 模型加载完成。选择骨骼，即可调整机器人姿态。';
    element('model-notice').title = model.notice;
    element<HTMLButtonElement>('reset-pose').disabled = !model.bones.length;
    element<HTMLButtonElement>('toggle-skeleton').disabled = !model.bones.length;
    renderBoneList();
    if (model.bones.length) {
      const initial = model.bones.find((entry) => entry.name === 'LeftUpperArm') || model.bones[0];
      selectBone(initial);
    } else {
      element('action-status').textContent = '该模型没有可调骨骼。请使用带骨骼的 GLB 模型。';
    }
  } catch (error) {
    if (destroyed) return;
    showError(`无法启动三维视窗：${error instanceof Error ? error.message : '未知错误'}。请确认浏览器支持 WebGL 2 并启用硬件加速。`);
    element('source-badge').textContent = '启动失败';
    element('file-name').textContent = '模型不可用';
    const notice = element('model-notice').querySelector('span');
    if (notice) notice.textContent = '三维视窗启动失败，请检查图形支持或重新加载页面。';
  }
}

function dispose(): void {
  if (destroyed) return;
  destroyed = true;
  lifetime.abort();
  scene?.dispose();
}

if (import.meta.hot) import.meta.hot.dispose(dispose);
void initialize();
