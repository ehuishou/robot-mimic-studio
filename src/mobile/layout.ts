export function renderMobileLayout(container: HTMLElement, embedded = false): void {
  container.innerHTML = `
    <header class="topbar"><a class="brand" href="./">robot<span>studio</span><b>.</b></a><a class="back-link" href="./mapping.html">动作映射 ↗</a><a class="back-link" href="./">模型工作台 <span>↗</span></a></header>
    <main>
      <section class="heading"><div class="eyebrow"><span></span> HUMAN MOTION / CAPTURE</div><div class="title-row"><h1>让身体，<br />成为起点<span>。</span></h1><span class="chapter">02<small>/ 05</small></span></div><p>站入画面，让每一个动作清晰可见。</p></section>
      <section class="capture-card" aria-label="实时姿态识别">
        <div class="capture-toolbar"><span class="toolbar-label"><i id="camera-light"></i> 实时捕捉 <small>LIVE CAPTURE</small></span><span class="chip">POSE / LITE</span></div>
        <div class="video-stage" id="video-stage">
          <div class="camera-layer"><video id="camera" playsinline muted autoplay aria-label="摄像头画面"></video><canvas id="pose-overlay" aria-label="人体关键点及骨架"></canvas></div>
          <div class="guide-corner tl"></div><div class="guide-corner tr"></div><div class="guide-corner bl"></div><div class="guide-corner br"></div>
          <div class="standby" id="standby"><svg viewBox="0 0 96 140" aria-hidden="true"><circle cx="48" cy="18" r="12"/><path d="M48 33v46m0-40L20 66m28-27l28 27M48 79l-22 42m22-42l22 42"/><circle cx="48" cy="39" r="3"/><circle cx="48" cy="79" r="3"/></svg><strong id="standby-title">准备好，让动作发生</strong><span id="standby-hint">启动摄像头，开始本地姿态识别</span></div>
          <div class="stage-label"><span>REAR CAMERA</span><span>单人 · 原始预览</span></div>
        </div>
        <div class="metrics"><div><span>识别状态</span><strong id="pose-status" role="status" aria-live="polite">尚未启动</strong></div><div><span>推理帧率</span><strong><b id="pose-fps">—</b><small> FPS</small></strong></div><div><span>有效 / 返回点</span><strong><b id="pose-visible">0</b><small> / <b id="pose-count">0</b></small></strong></div></div>
      </section>
      <section class="camera-controls" aria-label="摄像头与变焦设置">
        <div class="camera-selects"><label for="camera-facing">摄像头方向<select id="camera-facing"><option value="environment">后置摄像头（默认）</option><option value="user">前置摄像头</option></select></label><label for="camera-device">可用镜头<select id="camera-device" disabled><option value="">自动选择后置</option></select></label></div>
        <p id="camera-detail" class="camera-detail">优先后置 · 请求 1280 × 720，实际以设备为准</p>
        <div class="zoom-heading"><label for="camera-zoom">变焦</label><output id="zoom-value" for="camera-zoom">—</output></div>
        <input id="camera-zoom" type="range" min="1" max="1" step="0.1" value="1" disabled aria-describedby="zoom-hint" />
        <p id="zoom-hint" class="control-hint" role="status">启动后检测可用镜头及变焦范围。</p>
      </section>
      <div class="actions"><button id="start-camera" type="button"><span>◉</span> 启动摄像头 <span class="button-arrow">↗</span></button><button id="stop-camera" type="button" disabled><span>■</span> 停止</button></div>
      <p class="error" id="pose-error" role="alert" hidden></p>
      <p class="load-status" id="load-status" role="status" aria-live="polite">默认使用后置摄像头，点击启动后请允许摄像头权限。</p>
      <section class="tips"><div class="tips-heading"><span>获得更好的识别效果</span><small>CAPTURE NOTES</small></div><div class="tip"><b>01</b><p>全身尽量入镜<span>调整距离或变焦，让头部与四肢完整可见。</span></p></div><div class="tip"><b>02</b><p>在光线充足的地方<span>面向光源，避免强烈背光和遮挡。</span></p></div><div class="privacy"><span>⌁</span><p>画面留在你的设备上<small>本地处理 · 不上传视频 · 不录制画面</small></p><span class="privacy-dot"></span></div></section>
    </main><footer><span>ROBOT STUDIO / MOTION LAB</span><span>STAGE 02</span></footer>`;
  if (embedded) {
    container.querySelectorAll('header, .heading, .tips, footer').forEach(node => node.remove());
    const main = container.querySelector('main')!;
    main.replaceWith(...main.childNodes);
  }
}
