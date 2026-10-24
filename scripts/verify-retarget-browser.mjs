import { fixtureGLB } from './fixtures/robot-glb.mjs';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
const base = process.env.TEST_URL || 'http://127.0.0.1:5173';
const artifacts = new URL('../artifacts/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || undefined, args: ['--enable-unsafe-swiftshader'] });
const report = { source: base, scenarios: [], samples: [] }, errors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
const external = [];
page.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(base).origin) external.push(request.url()); });
let modelRequests = 0;
page.on('request', request => { if (request.url().endsWith('/models/robot.glb')) modelRequests++; });
await page.addInitScript(({ image }) => {
  window.__streams = []; window.__constraints = []; window.__zoom = [];
  Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { value: async () => [
    { kind: 'videoinput', deviceId: 'rear', label: '模拟后摄' }, { kind: 'videoinput', deviceId: 'front', label: '模拟前摄' },
  ] });
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async constraints => {
    window.__constraints.push(constraints);
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d'); const photo = new Image();
    if (image) { photo.src = image; await photo.decode(); }
    const stream = canvas.captureStream(15), track = stream.getVideoTracks()[0];
    const front = constraints.video.deviceId?.exact === 'front' || constraints.video.facingMode?.ideal === 'user';
    let zoom = 1;
    Object.defineProperty(track, 'getSettings', { value: () => ({ facingMode: front ? 'user' : 'environment', width: 640, height: 480, zoom }) });
    Object.defineProperty(track, 'getCapabilities', { value: () => ({ zoom: { min: 1, max: 3, step: 0.1 } }) });
    Object.defineProperty(track, 'applyConstraints', { value: async request => { zoom = request.advanced[0].zoom; window.__zoom.push(zoom); } });
    const timer = setInterval(() => {
      if (track.readyState === 'ended') { clearInterval(timer); return; }
      ctx.fillStyle = '#ddd'; ctx.fillRect(0, 0, 640, 480); if (image) ctx.drawImage(photo, 0, 0, 640, 480);
    }, 65);
    window.__streams.push(stream); return stream;
  } });
}, { image: process.env.POSE_PERSON === '1' ? `data:image/jpeg;base64,${(await readFile(new URL('pose-fixture.jpg', artifacts))).toString('base64')}` : null });
const states = async () => page.locator('.arm-debug').evaluateAll(nodes => nodes.map(node => ({ side: node.dataset.side, q: JSON.parse(node.dataset.actual), state: node.dataset.state })));
const magnitude = q => Math.hypot(...q.slice(0, 3));
const stable = async side => page.waitForFunction(side => {
  const arm = document.querySelector(`.arm-debug[data-side="${side}"]`);
  return arm && Math.hypot(...JSON.parse(arm.dataset.actual).slice(0, 3)) > 0.6;
}, side);
const rest = async () => page.waitForFunction(() => [...document.querySelectorAll('.arm-debug')].every(node => Math.hypot(...JSON.parse(node.dataset.actual).slice(0, 3)) < 0.00001));
const stopped = async () => page.waitForFunction(() => window.__streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')) && document.getElementById('camera').srcObject === null);
try {
  await page.goto(`${base}/mapping.html`);
  await page.waitForFunction(() => document.getElementById('app').dataset.ready === 'true');
  assert.equal(await page.locator('#mapping-viewport canvas').count(), 1);
  assert.equal(await page.locator('#rig-source').textContent(), 'robot.glb · 实际骨架');
  assert.equal(await page.locator('.arm-debug').count(), 2);
  assert.equal(await page.locator('.binding-debug').count(), 14);
  assert.match(await page.locator('#mapping-warning').textContent(), /已读取 GLB 骨架及专属映射配置/);
  assert.match(await page.locator('#rig-tree').textContent(), /LeftUpperArm.*Chest/);
  assert.equal(await page.evaluate(() => window.__constraints.length), 0);
  await page.locator('#simulation').selectOption('left'); await stable('left');
  assert.ok(magnitude((await states()).find(s => s.side === 'right').q) < 1e-5);
  await page.locator('#simulation').selectOption('right'); await stable('right');
  await page.waitForFunction(() => Math.hypot(...JSON.parse(document.querySelector('.arm-debug[data-side="left"]').dataset.actual).slice(0, 3)) < 0.001);
  report.scenarios.push('independent left/right simulation with actual hierarchy; camera remains off until requested');
  await page.locator('#toggle-follow').click();
  await page.waitForFunction(() => document.querySelector('.arm-debug').dataset.state === 'paused');
  const paused = await states(); await page.locator('#simulation').selectOption('both');
  await page.waitForTimeout(350); assert.deepEqual(await states(), paused);
  await page.locator('#reset-mapping').click(); await rest();
  assert.match(await page.locator('#toggle-follow').textContent(), /继续/);
  await page.locator('#toggle-follow').click(); await stable('left');
  await page.locator('#simulation').selectOption('loss');
  await page.waitForFunction(() => ['recovering', 'rest'].includes(document.querySelector('.arm-debug[data-side="left"]').dataset.state));
  await rest();
  for (const mode of ['invalid', 'missing', 'antipode', 'forward']) {
    await page.locator('#simulation').selectOption(mode); await page.waitForTimeout(300);
    assert.ok((await states()).every(s => s.q.every(Number.isFinite)));
  }
  report.scenarios.push('pause freezes rotation, reset returns exact rest, loss/invalid/missing input stays finite and recovers');
  for (const mode of ['full', 'walk']) {
    await page.locator('#simulation').selectOption(mode);
    await page.waitForFunction(() => [...document.querySelectorAll('.binding-debug')].length === 14 && [...document.querySelectorAll('.binding-debug')].every(node => node.dataset.state === 'tracking'));
    await page.waitForTimeout(900);
    const joints = await page.locator('.binding-debug').evaluateAll(nodes => nodes.map(node => ({ segment: node.dataset.segment, q: JSON.parse(node.dataset.actual) })));
    assert.ok(joints.every(joint => joint.q.every(Number.isFinite)));
    assert.ok(joints.every(joint => Math.hypot(...joint.q.slice(0, 3)) > 0.005), 'torso, neck, limbs, hands and feet all respond');
  }
  await page.screenshot({ path: fileURLToPath(new URL('mapping-full-body.png', artifacts)), fullPage: true });
  await page.locator('#simulation').selectOption('missing');
  await page.waitForFunction(() => [...document.querySelectorAll('.binding-debug')].every(node => node.dataset.state === 'rest'));
  await page.locator('#reset-mapping').click();
  assert.ok(await page.locator('.binding-debug').evaluateAll(nodes => nodes.every(node => Math.hypot(...JSON.parse(node.dataset.actual).slice(0, 3)) < 1e-5)));
  await page.locator('#toggle-follow').click();
  report.scenarios.push('actual robot.glb: all 14 full-body and step directions track, remain finite, recover after loss, and reset exactly');
  await page.locator('#simulation').selectOption('left'); await stable('left');
  await page.screenshot({ path: fileURLToPath(new URL('mapping-desktop.png', artifacts)), fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await page.screenshot({ path: fileURLToPath(new URL('mapping-mobile.png', artifacts)), fullPage: true });
  report.scenarios.push('390px and 320px simulation layouts fit viewport');
  await page.locator('#input-source').selectOption('camera');
  await page.locator('#start-camera').click();
  await page.waitForFunction(() => document.getElementById('load-status').textContent.includes('识别运行中'), undefined, { timeout: 90000 });
  assert.equal(await page.evaluate(() => window.__constraints[0].video.facingMode.ideal), 'environment');
  assert.equal(await page.locator('#pose-error').isVisible(), false);
  if (process.env.POSE_PERSON === '1') {
    await page.waitForFunction(() => document.getElementById('pose-count').textContent === '33', undefined, { timeout: 90000 });
    await page.waitForFunction(() => [...document.querySelectorAll('.arm-debug')].some(node => node.dataset.state === 'tracking' && Math.hypot(...JSON.parse(node.dataset.actual).slice(0, 3)) > 0.05));
    report.scenarios.push('actual MediaPipe model + official person image via simulated rear video drives robot arms (desktop, not real phone)');
    const seconds = Number(process.env.MAPPING_DURATION || 0);
    const until = Date.now() + seconds * 1000;
    while (Date.now() < until) {
      await page.waitForTimeout(10000);
      const sample = await page.evaluate(() => ({ fps: document.getElementById('pose-fps').textContent, render: document.getElementById('mapping-fps').textContent,
        count: document.getElementById('pose-count').textContent, heap: performance.memory?.usedJSHeapSize,
        streams: window.__streams.filter(stream => stream.getTracks().some(track => track.readyState === 'live')).length,
        finite: [...document.querySelectorAll('.arm-debug')].every(node => JSON.parse(node.dataset.actual).every(Number.isFinite)) }));
      report.samples.push(sample); console.log('Mapping sample:', sample);
    }
    assert.ok(report.samples.every(s => s.count === '33' && s.streams === 1 && s.finite && Number(s.fps) > 0));
  }
  await page.locator('#camera-zoom').evaluate(input => { input.value = '2'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForFunction(() => window.__zoom.includes(2));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: fileURLToPath(new URL('mapping-camera.png', artifacts)), fullPage: true });
  await page.locator('#camera-facing').selectOption('user');
  await page.waitForFunction(() => window.__streams.length >= 2 && window.__streams[0].getTracks().every(track => track.readyState === 'ended'));
  await page.waitForFunction(() => document.getElementById('load-status').textContent.includes('识别运行中'), undefined, { timeout: 90000 });
  assert.match(await page.locator('.camera-layer').getAttribute('style'), /scaleX\(-1\)/);
  await page.locator('#input-source').selectOption('simulation'); await stopped();
  assert.equal(await page.locator('#camera-zoom').isDisabled(), true);
  assert.equal(await page.locator('#mapping-viewport canvas').count(), 1);
  assert.equal(await page.locator('#rig-source').textContent(), 'robot.glb · 实际骨架');
  assert.equal(await page.locator('.arm-debug').count(), 2);
  assert.match(await page.locator('#mapping-warning').textContent(), /已读取 GLB 骨架及专属映射配置/);
  assert.equal(modelRequests, 1);
  report.scenarios.push('integrated rear-camera, native zoom, front-camera switching, input-source stop and single robot load');
  // Returning through navigation must not leave tracks behind, including a session starting during exit.
  await page.locator('#input-source').selectOption('camera'); await page.locator('#start-camera').click();
  await page.waitForFunction(() => window.__streams.length >= 3);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await stopped();
  report.scenarios.push('pagehide cancels and releases active capture');
  for (const mode of ['absent', 'configured', 'bad-path']) {
    const fixturePage = await context.newPage(); fixturePage.on('pageerror', error => errors.push(error.message));
    await fixturePage.route('**/models/robot.glb', route => route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: fixtureGLB() }));
    await fixturePage.route('**/models/robot.mapping.json', route => mode === 'absent' ? route.fulfill({ status: 404, body: 'Not found' }) :
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 1, bindings: [{
        side: 'left', segment: 'upperArm', bonePath: mode === 'bad-path' ? [999] : [0, 0], endPath: [0, 0, 0],
        expectedBoneName: 'ActualRoot', expectedEndName: 'CustomElbow', maxSwingRadians: 2.8, axisCorrection: [0, 0, 0, 1],
      }] }) }));
    await fixturePage.goto(base + '/mapping.html');
    await fixturePage.waitForFunction(() => document.getElementById('app').dataset.ready === 'true');
    assert.match(await fixturePage.locator('#rig-tree').textContent(), /ActualRoot.*FixtureArmature/);
    if (mode === 'configured') {
      assert.equal(await fixturePage.locator('.arm-debug').count(), 1);
      assert.match(await fixturePage.locator('.arm-debug').textContent(), /ActualRoot/);
      await fixturePage.locator('#simulation').selectOption('left');
      await fixturePage.waitForFunction(() => Math.hypot(...JSON.parse(document.querySelector('.arm-debug').dataset.actual).slice(0, 3)) > 0.6);
      await fixturePage.locator('#reset-mapping').click();
      await fixturePage.waitForFunction(() => Math.hypot(...JSON.parse(document.querySelector('.arm-debug').dataset.actual).slice(0, 3)) === 0);
    } else {
      assert.equal(await fixturePage.locator('#toggle-follow').isDisabled(), true);
      assert.equal(await fixturePage.locator('.arm-debug').count(), 0);
      assert.match(await fixturePage.locator('#mapping-warning').textContent(), mode === 'absent' ? /robot.mapping.json/ : /不匹配/);
    }
    await fixturePage.close();
  }
  report.scenarios.push('synthetic GLB: actual imported names, explicit JSON mapping drive/reset, missing and mismatched config warnings (not delivery-asset acceptance)');
  assert.deepEqual(external, []); assert.deepEqual(errors, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await writeFile(new URL('retarget-browser-results.json', artifacts), JSON.stringify({ ...report, errors }, null, 2));
  await browser.close();
}
