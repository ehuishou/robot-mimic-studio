import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const base = process.env.TEST_URL || 'http://127.0.0.1:5173';
const artifacts = new URL('../artifacts/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || undefined, args: ['--enable-unsafe-swiftshader'] });
const report = { scenarios: [], source: base, sustained: null };
const errors = [];
async function setup(mode = 'blank', delay = 0) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(({ mode, delay, image }) => {
    window.__streams = [];
    window.__created = 0;
    window.__videoPending = new Set();
    const nativeRequest = HTMLVideoElement.prototype.requestVideoFrameCallback;
    const nativeCancel = HTMLVideoElement.prototype.cancelVideoFrameCallback;
    if (nativeRequest) {
      HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) {
        const id = nativeRequest.call(this, (now, metadata) => { window.__videoPending.delete(id); callback(now, metadata); });
        window.__videoPending.add(id);
        return id;
      };
      HTMLVideoElement.prototype.cancelVideoFrameCallback = function (id) { window.__videoPending.delete(id); return nativeCancel.call(this, id); };
    }
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      if (mode === 'denied') throw new DOMException('Test denied', 'NotAllowedError');
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      const ctx = canvas.getContext('2d');
      const img = new Image();
      if (image) { img.src = image; await img.decode(); }
      let timer;
      const stream = canvas.captureStream(15);
      const paint = () => {
        if (!stream.getTracks().some((track) => track.readyState === 'live')) { clearInterval(timer); return; }
        ctx.fillStyle = '#f4f4f4'; ctx.fillRect(0, 0, 640, 480);
        if (image) ctx.drawImage(img, 0, 0, 640, 480);
      };
      timer = setInterval(paint, 65); paint();
      window.__streams.push(stream); window.__created++;
      return stream;
    } });
  }, { mode, delay, image: mode === 'person' ? `data:image/jpeg;base64,${(await readFile(new URL('pose-fixture.jpg', artifacts))).toString('base64')}` : null });
  const external = [];
  page.on('request', (request) => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(base).origin) external.push(request.url()); });
  await page.goto(`${base}/pose.html`);
  return { page, context, external };
}
const stopped = async (page) => {
  await page.waitForFunction(() => window.__streams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended')));
  assert.equal(await page.locator('#stop-camera').isDisabled(), true);
  assert.equal(await page.locator('#start-camera').isEnabled(), true);
  assert.equal(await page.locator('#pose-count').textContent(), '0');
  assert.equal(await page.evaluate(() => window.__videoPending.size), 0);
  assert.equal(await page.evaluate(() => document.getElementById('camera').srcObject === null), true);
};
try {
  {
    const { page, context } = await setup('denied');
    await page.locator('#start-camera').click(); await page.locator('#pose-error').waitFor({ state: 'visible' });
    assert.match(await page.locator('#pose-error').textContent(), /权限被拒绝/);
    await stopped(page); await context.close(); report.scenarios.push('permission denial: readable error and clean state');
  }
  {
    const { page, context } = await setup('blank', 800);
    await page.locator('#start-camera').click(); await page.locator('#stop-camera').click();
    await page.waitForFunction(() => window.__created === 1); await stopped(page);
    await context.close(); report.scenarios.push('stop while getUserMedia pending: late tracks ended');
  }
  {
    const { page, context } = await setup();
    let requested;
    const modelRequested = new Promise((resolve) => { requested = resolve; });
    await page.route('**/mediapipe/models/*.task', async (route) => {
      requested();
      await new Promise((resolve) => setTimeout(resolve, 600));
      try { await route.continue(); } catch { /* Aborted by stop. */ }
    });
    await page.locator('#start-camera').click(); await modelRequested;
    await page.locator('#stop-camera').click(); await stopped(page);
    await page.waitForTimeout(900); await stopped(page);
    await context.close(); report.scenarios.push('stop while model fetch pending: no delayed restart or residual callback');
  }
  for (const failure of ['models/*.task', 'wasm/*.wasm']) {
    const { page, context } = await setup();
    await page.route(`**/mediapipe/${failure}`, (route) => route.fulfill({ status: 503, body: 'Unavailable test fixture' }));
    await page.locator('#start-camera').click();
    await page.locator('#pose-error').waitFor({ state: 'visible', timeout: 90000 });
    assert.match(await page.locator('#pose-error').textContent(), failure.startsWith('models') ? /模型加载失败/ : /WASM/);
    await stopped(page); await context.close(); report.scenarios.push(`${failure}: failure closes camera and permits retry`);
  }
  {
    const { page, context, external } = await setup();
    await page.locator('#start-camera').click();
    await page.waitForFunction(() => Number(document.getElementById('pose-fps').textContent) > 0, undefined, { timeout: 90000 });
    assert.equal(await page.locator('#pose-status').textContent(), '等待人体入镜');
    assert.equal(await page.locator('#pose-count').textContent(), '0');
    await page.locator('#stop-camera').click(); await stopped(page);
    await page.locator('#start-camera').click();
    await page.waitForFunction(() => Number(document.getElementById('pose-fps').textContent) > 0, undefined, { timeout: 90000 });
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await stopped(page); assert.deepEqual(external, []);
    await context.close(); report.scenarios.push('real WASM/model on blank stream: empty state, stop/restart and pagehide cleanup');
  }
  if (process.env.POSE_PERSON === '1') {
    const { page, context, external } = await setup('person');
    await page.locator('#start-camera').click();
    await page.waitForFunction(() => document.getElementById('pose-count').textContent === '33', undefined, { timeout: 90000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: new URL('pose-mobile-person.png', artifacts).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
    report.scenarios.push('actual model on official test image via simulated video: 33 landmarks and 390px layout');
    const seconds = Number(process.env.POSE_DURATION || 0);
    if (seconds) {
      const samples = [];
      const until = Date.now() + seconds * 1000;
      while (Date.now() < until) {
        await page.waitForTimeout(15000);
        samples.push(await page.evaluate(() => ({ fps: document.getElementById('pose-fps').textContent, count: document.getElementById('pose-count').textContent, streams: window.__streams.filter((s) => s.getTracks().some((t) => t.readyState === 'live')).length, heap: performance.memory?.usedJSHeapSize })));
        console.log('Sustained sample:', samples.at(-1));
      }
      assert(samples.every((s) => s.count === '33' && s.streams === 1 && Number(s.fps) > 0));
      report.sustained = { seconds, samples, note: 'Desktop Edge with simulated camera and real model, not a phone test. Heap samples include garbage collection fluctuations.' };
    }
    await page.locator('#stop-camera').click(); await stopped(page); assert.deepEqual(external, []);
    await context.close();
  } else {
    const { page, context } = await setup();
    await page.screenshot({ path: new URL('pose-mobile-idle.png', artifacts).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.setViewportSize({ width: 320, height: 740 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await context.close(); report.scenarios.push('390px and 320px layouts without horizontal overflow');
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await writeFile(new URL('pose-browser-results.json', artifacts), JSON.stringify({ ...report, errors }, null, 2));
  await browser.close();
}
