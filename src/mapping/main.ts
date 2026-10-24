import '../mobile/style.css';
import './style.css';
import * as THREE from 'three';
import { StudioScene } from '../scene/StudioScene';
import { loadRobot, disposeObject } from '../robot/model';
import type { RobotModel } from '../robot/model';
import { mountCapturePanel } from '../mobile/capturePanel';
import { fallbackMapping, resolvePath } from '../retarget/rigMapping';
import { loadRigConfig } from '../retarget/loadRigConfig';
import { Retargeter } from '../retarget/Retargeter';
import { toRetargetFrame } from '../retarget/poseAdapter';
import { simulatedPose, SIMULATIONS } from '../retarget/simulatedPose';
import type { Simulation } from '../retarget/simulatedPose';
import type { RetargetFrame } from '../retarget/types';
import { renderDebug } from '../retarget/debugPanel';
import { createPoseClient, type ConnectionState } from '../communication/client';
import type { HelloMessage, PoseMessage } from '../communication/protocol';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
el('app').innerHTML = `
<header class="mapping-header"><a class="brand" href="./">robot<span>studio</span><b>.</b></a><nav><a href="./">模型工作台 ↗</a><a href="./pose.html">姿态识别 ↗</a></nav></header>
<main class="mapping-workspace">
  <section class="mapping-heading"><div><div class="eyebrow">HUMAN → ROBOT / MOTION MAPPING</div><h1>让动作，产生共鸣<span>。</span></h1><p>从你的双臂，到机器人的下一次抬手。</p></div><span class="chapter">04<small>/ 05</small></span></section>
  <div class="mapping-grid">
    <section class="robot-panel"><div class="panel-bar"><strong>动作视窗 <small>LIVE RETARGET</small></strong><span id="mapping-fps">— FPS</span></div>
      <div id="mapping-viewport" aria-label="机器人动作映射视窗"></div>
      <div class="model-caption"><span id="rig-source">正在加载模型…</span><span id="follow-status" role="status">准备中</span></div>
      <div class="follow-actions"><button id="toggle-follow" disabled>暂停跟随</button><button id="reset-mapping" disabled>重置姿势</button><button id="front-view">正面视角</button><button id="show-rig" aria-pressed="false">显示骨架</button></div>
      <p class="mapping-help">绿色箭头为输入方向，灰色箭头为实际臂向。暂停可保持姿态；重置后点击继续跟随。</p>
      <p id="mapping-error" class="error" role="alert" hidden></p><p id="mapping-warning" class="mapping-notice" role="status"></p>
    </section>
    <section class="input-panel"><div class="panel-bar"><strong>动作来源 <small>INPUT SOURCE</small></strong><span class="local-chip">本机处理</span></div>
      <div class="source-controls"><label for="input-source">输入方式</label><select id="input-source"><option value="simulation">模拟姿态</option><option value="camera">本机摄像头</option><option value="remote">手机 WebSocket</option></select>
      <div class="pair-controls"><button id="create-pair" type="button">创建手机配对</button><p id="pair-status" role="status">在电脑上创建一次性配对，再用手机打开生成的链接。</p><a id="mobile-link" hidden></a><button id="copy-link" type="button" hidden>复制手机链接</button></div>
      <div id="simulation-controls"><label for="simulation">模拟动作</label><select id="simulation">${Object.entries(SIMULATIONS).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select><p>先选择“只抬左臂”或“只抬右臂”，检查两侧独立运动，再试摄像头。</p></div></div>
      <div id="capture-panel" class="embedded-capture" hidden></div>
      <div class="input-notes"><span>01 / 解剖左右保持对应</span><span>02 / 肩、肘清晰入镜</span><span>03 / 当前驱动双上臂</span></div>
    </section>
  </div>
  <section class="debug-section"><details open><summary>映射观察 <small>方向 · 置信度 · 四元数 xyzw</small></summary><div id="mapping-debug" class="debug-grid"></div></details>
    <details><summary>实际模型骨架 <small id="rig-count"></small></summary><pre id="rig-tree"></pre></details>
    <p class="mapping-help">世界坐标用于相对方向。当前锁定轴向扭转并限制摆角，暂不驱动前臂、躯干及腿部。摄像头识别和机器人在此设备的同一页面运行。</p>
  </section>
</main><footer class="mapping-footer"><span>ROBOT STUDIO / MOTION LAB</span><span>STAGE 03</span></footer>`;

const lifetime = new AbortController();
let scene: StudioScene | undefined, model: RobotModel | undefined, retargeter: Retargeter | undefined;
let source: 'simulation' | 'camera' | 'remote' = 'simulation', paused = false, disposed = false;
let latest: RetargetFrame | undefined, simSeq = 0, remoteSeq = 0, sampledAt = -Infinity;
let remoteClient: ReturnType<typeof createPoseClient> | undefined;
const showError = (message: string) => { el('mapping-error').textContent = message; el('mapping-error').hidden = false; };
const refreshFollow = () => {
  el('toggle-follow').textContent = paused ? '继续跟随' : '暂停跟随';
  el('toggle-follow').setAttribute('aria-pressed', String(paused));
  el('follow-status').textContent = retargeter && !retargeter.debug().length ? '映射未绑定' : paused ? '已暂停' : source === 'simulation' ? '模拟跟随' : source === 'remote' ? '手机输入' : '摄像头跟随';
};
const clearInput = () => { latest = undefined; retargeter?.clearInput(); };
const capture = mountCapturePanel(el('capture-panel'), {
  onStart: clearInput, onStop: clearInput,
  onFrame: (frame, nowMs, seq) => {
    if (source !== 'camera' || disposed) return;
    latest = toRetargetFrame(frame, nowMs, seq); retargeter?.accept(latest, nowMs);
  },
}, true);
const signal = lifetime.signal;
el('input-source').addEventListener('change', () => {
  capture.stop(); clearInput();
  const value = el<HTMLSelectElement>('input-source').value;
  source = value === 'camera' || value === 'remote' ? value : 'simulation';
  el('capture-panel').hidden = source !== 'camera'; el('simulation-controls').hidden = source !== 'simulation';
  if (source !== 'remote') { remoteClient?.dispose(); remoteClient = undefined; }
  refreshFollow();
}, { signal });
el<HTMLButtonElement>('create-pair').addEventListener('click', async () => {
  const button = el<HTMLButtonElement>('create-pair'); button.disabled = true;
  el('pair-status').textContent = '正在创建安全配对…';
  try {
    const response = await fetch('/api/rooms', { method: 'POST', signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const pair = await response.json() as { room: string; mobileToken: string; viewerToken: string };
    const link = new URL('./pose.html', location.href);
    link.hash = new URLSearchParams({ room: pair.room, token: pair.mobileToken }).toString();
    const anchor = el<HTMLAnchorElement>('mobile-link'); anchor.href = link.href; anchor.textContent = `手机配对链接 · 房间 ${pair.room}`; anchor.hidden = false;
    el<HTMLButtonElement>('copy-link').hidden = false;
    const hello: HelloMessage = { type: 'hello', role: 'viewer', room: pair.room, token: pair.viewerToken };
    remoteClient?.dispose();
    remoteClient = createPoseClient(hello, (state: ConnectionState, detail) => {
      el('pair-status').textContent = detail || ({ connecting: '电脑连接中…', connected: `电脑已连接 · 房间 ${pair.room}`, disconnected: '电脑连接断开，正在重连…', error: '电脑连接错误' }[state]);
    }, (pose: PoseMessage) => {
      if (source !== 'remote' || paused || disposed) return;
      const now = performance.now();
      latest = toRetargetFrame({ normalizedLandmarks: [], worldLandmarks: pose.landmarks }, now, ++remoteSeq);
      retargeter?.accept(latest, now);
    });
    el<HTMLSelectElement>('input-source').value = 'remote'; el<HTMLSelectElement>('input-source').dispatchEvent(new Event('change'));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    el('pair-status').textContent = `创建配对失败：${error instanceof Error ? error.message : String(error)}`;
  } finally { button.disabled = false; }
}, { signal });
el<HTMLButtonElement>('copy-link').addEventListener('click', async () => {
  const link = el<HTMLAnchorElement>('mobile-link');
  try { await navigator.clipboard.writeText(link.href); el('pair-status').textContent = '手机链接已复制；凭据只保存在该链接片段中。'; }
  catch { el('pair-status').textContent = '浏览器未允许复制，请从地址栏复制手机链接。'; }
}, { signal });
el('toggle-follow').addEventListener('click', () => { paused = !paused; retargeter?.setPaused(paused); refreshFollow(); }, { signal });
el('reset-mapping').addEventListener('click', () => { retargeter?.reset(); latest = undefined; paused = true; refreshFollow(); }, { signal });
el('front-view').addEventListener('click', () => scene?.resetCamera('front'), { signal });
el('show-rig').addEventListener('click', () => {
  const button = el('show-rig'), enabled = button.getAttribute('aria-pressed') !== 'true';
  button.setAttribute('aria-pressed', String(enabled)); scene?.setSkeleton(enabled);
}, { signal });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { paused = true; retargeter?.setPaused(true); refreshFollow(); }
}, { signal });

async function initialize(): Promise<void> {
  try {
    scene = new StudioScene(el('mapping-viewport'), fps => { el('mapping-fps').textContent = `${fps} FPS`; }, showError);
    model = await loadRobot(signal);
    if (disposed) { disposeObject(model.root); return; }
    scene.addModel(model.root); scene.resetCamera('front');
    const rigConfig = model.source === 'fallback' ? { bindings: fallbackMapping(model.root, model.bones), notice: '' } : await loadRigConfig(signal);
    if (disposed) return;
    const configs = rigConfig.bindings;
    const activeConfigs = configs.filter(c => c.enabled !== false && c.segment !== 'forearm');
    retargeter = new Retargeter(model.root, model.bones, configs);
    el('rig-source').textContent = model.source === 'fallback' ? '内置机器人 · 17 根骨骼' : 'robot.glb · 实际骨架';
    el('mapping-warning').textContent = [model.source === 'fallback' ? '当前使用内置程序化骨架；真实 GLB 的映射与验收待模型加入后完成。' : rigConfig.notice || '已读取 GLB 骨架及专属映射配置。', ...retargeter.warnings].join(' ');
    el('rig-count').textContent = `${model.bones.length} BONES`;
    el('rig-tree').textContent = model.bones.map(e => `${'  '.repeat(e.depth)}${e.name} ← ${e.bone.parent?.name || '(无名父节点)'} | rest q=(${e.initialQuaternion.toArray().join(', ')})`).join('\n') || '此模型没有可驱动骨骼。';
    const boundNames = new Set(retargeter.debug().map(b => b.path));
    const arrows = activeConfigs.filter(c => boundNames.has(c.bonePath.join('/'))).map(config => {
      const entry = model!.bones.find(b => b.bone === resolvePath(model!.root, config.bonePath))!;
      const input = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(), 0.4, 0xb7eb7f);
      const actual = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(), 0.32, 0x8d9a91);
      for (const arrow of [input, actual]) {
        for (const part of [arrow.line, arrow.cone]) {
          for (const material of Array.isArray(part.material) ? part.material : [part.material]) material.depthTest = false;
          part.renderOrder = 10;
        }
      }
      scene!.scene.add(input, actual);
      return { side: config.side, entry, input, actual, reference: resolvePath(model!.root, config.endPath)!.position.clone().normalize() };
    });
    const origin = new THREE.Vector3(), direction = new THREE.Vector3(), quaternion = new THREE.Quaternion();
    scene.setUpdate((nowMs, dt) => {
      if (source === 'simulation') {
        latest = simulatedPose(el<HTMLSelectElement>('simulation').value as Simulation, nowMs, ++simSeq);
        retargeter!.accept(latest, nowMs);
      }
      retargeter!.update(nowMs, dt);
      if (nowMs - sampledAt < 150) return;
      sampledAt = nowMs;
      const debug = retargeter!.debug();
      if (retargeter!.warnings.length) el('mapping-warning').textContent = [rigConfig.notice || model!.notice, ...retargeter!.warnings].filter(Boolean).join(' ');
      renderDebug(el('mapping-debug'), debug, latest);
      for (const arrow of arrows) {
        const data = debug.find(b => b.side === arrow.side)!;
        arrow.entry.bone.getWorldPosition(origin); arrow.input.position.copy(origin); arrow.actual.position.copy(origin);
        arrow.input.visible = data.direction !== null && data.state !== 'rest' && data.state !== 'recovering';
        if (data.direction) arrow.input.setDirection(direction.fromArray(data.direction));
        arrow.entry.bone.getWorldQuaternion(quaternion);
        arrow.actual.setDirection(direction.copy(arrow.reference).applyQuaternion(quaternion).normalize());
      }
    });
    el<HTMLButtonElement>('toggle-follow').disabled = !retargeter.debug().length;
    el<HTMLButtonElement>('reset-mapping').disabled = !model.bones.length;
    el('app').dataset.ready = 'true'; refreshFollow();
  } catch (error) { if (!disposed) showError(`动作映射启动失败：${error instanceof Error ? error.message : String(error)}`); }
}
function dispose(): void {
  if (disposed) return;
  disposed = true; lifetime.abort(); capture.dispose(); remoteClient?.dispose(); retargeter?.dispose(); scene?.dispose();
}
window.addEventListener('pagehide', event => { if (!event.persisted) dispose(); }, { signal });
if (import.meta.hot) import.meta.hot.dispose(dispose);
void initialize();
