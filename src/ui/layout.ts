import { icon } from './icons';

export function renderLayout(container: HTMLElement): void {
  container.innerHTML = `
    <header class="topbar">
      <a class="brand" href="./" aria-label="Robot Studio 首页"><span class="brand-icon">${icon('robot')}</span><span>robot<span class="brand-light">studio</span><span class="brand-dot">.</span></span></a>
      <div class="header-divider"></div><span class="workspace-label">动作模仿实验室</span>
      <div class="header-right"><span class="phase-badge"><span></span>阶段 01 · 模型工作台</span><a class="version" href="./mapping.html">动作映射 ↗</a><a class="version" href="./pose.html" aria-label="打开手机姿态识别">姿态识别 ↗</a></div>
    </header>
    <main class="workspace">
      <section class="main-column">
        <div class="page-heading"><div><div class="eyebrow">ROBOT MOTION LAB</div><h1>让动作，有迹可循<span>。</span></h1><p>从一个姿态开始，探索人与机器的连接。</p></div><div class="heading-mark">01<span>/ 05</span></div></div>
        <section class="viewport-card" aria-label="机器人展示区">
          <div class="viewport-top"><div class="viewport-title">${icon('cube')}<span>三维视窗</span><span class="live-dot"></span><span class="small-label">LIVE</span></div><span id="source-badge" class="source-badge">准备模型</span></div>
          <div id="viewport" class="viewport"></div>
          <div class="scene-label"><span class="crosshair">+</span><div><span id="model-label">ROBOT / INITIALIZING</span><small id="model-subtitle">正在准备三维场景</small></div></div>
          <div id="loading" class="loading"><span class="spinner"></span><span>正在加载机器人模型…</span></div>
          <div id="scene-error" class="scene-error" role="alert" hidden></div>
          <div class="view-controls" role="group" aria-label="预设视角"><button data-view="perspective" class="active">透视</button><button data-view="front">正面</button><button data-view="side">侧面</button></div>
          <div class="scene-tools" role="group" aria-label="视窗工具"><button id="toggle-grid" class="tool-button active" aria-label="切换地面网格" aria-pressed="true" title="地面网格">${icon('grid')}</button><button id="toggle-skeleton" class="tool-button" aria-label="切换骨架显示" aria-pressed="false" title="显示骨架">${icon('bone')}</button><span></span><button id="toggle-rotate" class="tool-button" aria-label="切换自动旋转" aria-pressed="false" title="自动旋转">${icon('rotate')}</button><button id="reset-camera" class="tool-button" aria-label="重置视角" title="重置视角">${icon('focus')}</button></div>
          <div class="axis-legend" aria-label="坐标轴方向"><span class="axis-y">Y</span><span class="axis-z">Z</span><span class="axis-x">X</span><i></i></div>
          <div class="viewport-bottom"><span><span class="render-dot"></span>WebGL<span class="bottom-separator">/</span><strong id="fps">—</strong> FPS</span><span class="gesture-hint">拖动旋转<span>·</span>滚轮缩放<span>·</span>右键平移</span></div>
        </section>
        <div id="model-notice" class="notice" role="status">${icon('info')}<span>正在检查模型资源…</span></div>
        <section class="pipeline" aria-label="开发阶段"><div class="pipeline-caption"><span>从姿态到动作</span><small>THE ROAD AHEAD</small></div><div class="pipeline-step current"><span class="step-number">01</span><div><strong>模型工作台</strong><small>当前阶段</small></div></div><span class="pipeline-line"></span><div class="pipeline-step"><span class="step-number">02</span><div><strong>姿态识别</strong><small>MediaPipe</small></div></div><span class="pipeline-line"></span><div class="pipeline-step"><span class="step-number">03</span><div><strong>动作映射</strong><small>骨骼驱动</small></div></div><span class="pipeline-line"></span><div class="pipeline-step"><span class="step-number">04–05</span><div><strong>连接与集成</strong><small>WebSocket</small></div></div></section>
      </section>
      <aside class="inspector" aria-label="机器人调试面板">
        <div class="inspector-heading"><div>${icon('sliders')}<h2>模型检查器</h2></div><span class="inspector-tag">INSPECTOR</span></div>
        <section class="model-info"><span class="section-label">当前模型</span><div class="model-file"><span class="file-icon">${icon('cube')}</span><div><strong id="file-name">正在加载</strong><small id="file-detail">等待模型解析</small></div><span id="model-ready" class="ready-icon" hidden>${icon('check')}</span></div><div class="model-stats"><div><span>骨骼节点</span><strong id="bone-count">—</strong></div><div><span>网格数量</span><strong id="mesh-count">—</strong></div><div><span>坐标约定</span><strong class="coordinate-value">Y ↑</strong></div></div></section>
        <section class="bone-section"><div class="section-heading"><h3>骨骼层级</h3><span id="bone-total" class="count-badge">0</span></div><label class="search-field">${icon('search')}<input id="bone-search" type="search" placeholder="搜索骨骼名称…" aria-label="搜索骨骼名称" autocomplete="off" /></label><div id="bone-list" class="bone-list" role="group" aria-label="选择要调整的骨骼"><p class="empty-state">模型加载后显示骨骼</p></div><div class="hierarchy-caption"><span class="tiny-square"></span><span>显示实际骨骼名称与父子层级</span></div></section>
        <section class="rotation-section"><div class="section-heading"><h3>旋转调试</h3><span class="unit-badge">DEG</span></div><div class="selected-bone"><span>选中骨骼</span><strong id="selected-name">未选择</strong></div><fieldset id="rotation-controls" disabled><legend class="sr-only">相对初始姿势的局部旋转角度</legend>${(['X', 'Y', 'Z'] as const).map((axis, index) => `<div class="rotation-row"><label for="rotation-${axis.toLowerCase()}" class="axis-name axis-${axis.toLowerCase()}">${axis}</label><input id="rotation-${axis.toLowerCase()}" data-axis="${index}" type="range" min="-180" max="180" step="1" value="0" aria-label="${axis} 轴旋转角度" /><output id="value-${axis.toLowerCase()}" for="rotation-${axis.toLowerCase()}">0°</output></div>`).join('')}</fieldset><p class="rotation-help">相对初始姿势 · 局部坐标 · XYZ 顺序</p><button id="reset-pose" class="reset-button" disabled>${icon('reset')}重置全部姿势<span>RESET</span></button><p id="action-status" class="action-status" role="status" aria-live="polite">选择骨骼，开始探索它的运动。</p></section>
        <div class="inspector-footer">${icon('code')}<span>Built with Three.js</span><span class="footer-dot"></span><span>本地渲染</span></div>
      </aside>
    </main>
    <footer class="page-footer"><span>ROBOT STUDIO<span class="footer-slash">/</span>让每一个关节，都有无限可能。</span><span>MODEL WORKSPACE<span class="footer-status"><i></i> 本地处理</span></span></footer>`;
}
