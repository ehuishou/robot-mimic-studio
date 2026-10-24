import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import WebSocket from 'ws';
import { simulatedPose } from '../src/retarget/simulatedPose.ts';

// Synthetic mobile sender -> actual relay -> production browser -> actual skinned robot.glb.
// This verifies transport/rendering, not phone-camera accuracy or mobile thermal stability.
const base = process.env.TEST_URL || 'http://127.0.0.1:8082';
const insecure = process.env.TEST_ALLOW_SELF_SIGNED === '1';
const artifacts = new URL('../artifacts/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || undefined, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, ignoreHTTPSErrors: insecure });
const report = { source: base, kind: 'synthetic-mobile-through-real-relay', scenarios: [], errors: [] };
page.on('pageerror', error => report.errors.push(error.message));
let mobile, timer, sending = false, seq = 0, sessionId = 'fullbody_session_01', mode = 'full';
let yaw = 0, chestTwist = 0, lift = 0, imageMotion, jitter = false;
const motionSnapshot = () => page.locator('#motion-status').evaluate(node => JSON.parse(node.dataset.motion));
function wirePose(timestamp) {
  const pose = simulatedPose(mode, timestamp, seq);
  const landmarks = pose.worldLandmarks.map((p, i) => {
    const angle = yaw + (i < 23 ? chestTwist : 0), c = Math.cos(angle), s = Math.sin(angle);
    return { ...p, x: c * p.x - s * p.z, z: s * p.x + c * p.z, y: p.y - ([25, 27, 31].includes(i) ? lift : 0) };
  });
  const motion = imageMotion && { ...imageMotion, x: imageMotion.x + (jitter ? Math.sin(timestamp / 800) * 0.002 : 0) };
  return { landmarks, ...(motion ? { motion } : {}) };
}
const snapshot = () => page.locator('.binding-debug').evaluateAll(nodes => nodes.map(node => ({ side: node.dataset.side, segment: node.dataset.segment, state: node.dataset.state, q: JSON.parse(node.dataset.actual) })));
const waitTracking = () => page.waitForFunction(() => {
  const nodes = [...document.querySelectorAll('.binding-debug')];
  return nodes.length === 14 && nodes.every(node => node.dataset.state === 'tracking' && JSON.parse(node.dataset.actual).every(Number.isFinite));
}, undefined, { timeout: 15000 });
const send = message => mobile.send(JSON.stringify(message));
function waitReady(socket) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error('Mobile authentication timeout')); }, 10000);
    const cleanup = () => { clearTimeout(timeout); socket.off('message', onMessage); socket.off('close', onClose); };
    const onClose = code => { cleanup(); reject(new Error(`Mobile closed before ready: ${code}`)); };
    const onMessage = raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'ready') { cleanup(); resolve(); }
      else if (message.type === 'error') { cleanup(); reject(new Error(message.code)); }
    };
    socket.on('message', onMessage); socket.on('close', onClose);
  });
}
try {
  await page.goto(`${base}/mapping.html`);
  await page.waitForFunction(() => document.getElementById('app').dataset.ready === 'true', undefined, { timeout: 75000 });
  assert.equal(await page.locator('#rig-source').textContent(), 'robot.glb · 实际骨架');
  await page.locator('#create-pair').click();
  await page.locator('#mobile-link').waitFor({ state: 'visible' });
  const link = new URL(await page.locator('#mobile-link').getAttribute('href'));
  const credentials = new URLSearchParams(link.hash.slice(1));
  const room = credentials.get('room');
  assert.ok(room && credentials.get('token'), 'Pairing produces credentials in link fragment');
  const url = new URL('/ws', base); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  mobile = new WebSocket(url, { origin: new URL(base).origin, rejectUnauthorized: !insecure });
  mobile.on('error', error => report.errors.push(error.message));
  mobile.on('message', raw => { const message = JSON.parse(raw.toString()); if (message.type === 'error') report.errors.push(`Relay: ${message.code}`); });
  await once(mobile, 'open');
  const ready = waitReady(mobile);
  send({ type: 'hello', version: 1, role: 'mobile', room, token: credentials.get('token') });
  await ready;
  await page.waitForFunction(() => document.getElementById('pair-status').textContent.includes('手机已加入'));
  const capture = state => send({ type: 'capture', version: 1, room, sessionId, state });
  capture('started'); sending = true;
  timer = setInterval(() => {
    if (!sending || mobile.readyState !== WebSocket.OPEN) return;
    const timestamp = Date.now();
    send({ type: 'pose', version: 1, room, sessionId, timestamp, seq: ++seq, ...wirePose(timestamp) });
  }, 80);
  await waitTracking(); await page.waitForTimeout(1300);
  const full = await snapshot();
  assert.ok(full.every(joint => Math.hypot(...joint.q.slice(0, 3)) > 0.005), 'All 14 joints respond to transmitted full-body pose');
  report.scenarios.push('pair/authenticate mobile, capture start, 33 world landmarks via real WebSocket relay, all 14 GLB bindings track and move');
  await page.locator('#toggle-follow').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.binding-debug')].every(node => node.dataset.state === 'paused'));
  const frozen = await snapshot(); mode = 'walk';
  await page.waitForTimeout(700); assert.deepEqual(await snapshot(), frozen);
  await page.locator('#toggle-follow').click();
  await waitTracking(); await page.waitForTimeout(1000);
  const resumed = await snapshot();
  assert.ok(resumed.some((joint, index) => joint.segment === 'upperLeg' && Math.hypot(...joint.q.map((v, i) => v - frozen[index].q[i])) > 0.03));
  report.scenarios.push('pause freezes all joints; resume uses still-active phone session without another capture-start');
  await page.locator('#reset-mapping').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.binding-debug')].every(node => node.dataset.state === 'paused' && Math.hypot(...JSON.parse(node.dataset.actual).slice(0, 3)) < 1e-5));
  await page.locator('#toggle-follow').click(); await waitTracking();
  report.scenarios.push('reset restores all bones; resume again accepts existing capture session');
  sending = false; capture('stopped');
  await page.waitForFunction(() => [...document.querySelectorAll('.binding-debug')].every(node => node.dataset.state === 'rest'), undefined, { timeout: 15000 });
  sessionId = 'fullbody_session_02'; seq = 0; mode = 'full'; capture('started'); sending = true;
  await waitTracking(); await page.waitForTimeout(1200);
  assert.equal(mobile.readyState, WebSocket.OPEN);
  await page.locator('.debug-section details').first().evaluate(node => { node.open = false; });
  await page.screenshot({ path: fileURLToPath(new URL('full-body-websocket.png', artifacts)), fullPage: true });
  report.scenarios.push('capture stop recovers all joints; new capture session accepts reset sequence and drives whole body again');
  // Exercise enhanced motion through the same authenticated mobile session, not a browser-only hook.
  mode = 'neutral'; imageMotion = { x: 0.5, y: 0.6, scale: 0.25 };
  await page.waitForFunction(() => {
    const m = JSON.parse(document.getElementById('motion-status').dataset.motion || 'null');
    return m?.calibrated && m.feet.every(f => f.locked && f.error < 0.008);
  }, undefined, { timeout: 15000 });
  await page.waitForTimeout(900);
  const neutral = await snapshot();
  assert.ok(Math.hypot(...neutral.find(j => j.segment === 'neck').q.slice(0, 3)) < 0.015, 'neutral face must not force permanent downward neck pitch');
  const planted = await motionSnapshot(); jitter = true;
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(140);
    const m = await motionSnapshot();
    assert.ok(m.feet.every((f, j) => f.locked && f.error < 0.008 && Math.hypot(...f.anchor.map((v, k) => v - planted.feet[j].anchor[k])) < 1e-6));
  }
  report.scenarios.push('actual GLB neutral head remains upright; two-bone leg IK keeps both world anchors stable under image-motion jitter');
  jitter = false; lift = 0.22;
  await page.waitForFunction(() => !JSON.parse(document.getElementById('motion-status').dataset.motion).feet[0].locked);
  lift = 0;
  await page.locator('#foot-lock').uncheck();
  assert.ok((await motionSnapshot()).feet.every(f => !f.locked));
  for (const angle of [Math.PI / 2, Math.PI, Math.PI * 1.5, Math.PI * 2]) {
    yaw = angle;
    await page.waitForFunction(angle => {
      const q = JSON.parse(document.getElementById('motion-status').dataset.motion).rotation;
      return Math.abs(q[1] * Math.sin(angle / 2) + q[3] * Math.cos(angle / 2)) > 0.999;
    }, angle, { timeout: 10000 });
  }
  chestTwist = 0.7; await page.waitForTimeout(1100);
  const twist = await snapshot();
  assert.ok(Math.hypot(...twist.find(j => j.segment === 'torso').q.slice(0, 3)) > 0.3, 'chest twists relative to hips');
  assert.ok(Math.abs((await motionSnapshot()).yawDegrees) < 2, 'pelvis remains forward during isolated chest twist');
  chestTwist = 0;
  report.scenarios.push('lift releases the foot; lock toggle works; actual hips track 90/180/270/360 degrees across wrap; chest twists independently');
  for (let step = 1; step <= 25; step++) { imageMotion.x = 0.5 + step * 0.002; await page.waitForTimeout(85); }
  await page.waitForFunction(() => JSON.parse(document.getElementById('motion-status').dataset.motion).position[0] > 0.12);
  await page.locator('#toggle-follow').click();
  const frozenMotion = await motionSnapshot(); imageMotion.x = 0.56;
  await page.waitForTimeout(400);
  assert.deepEqual((await motionSnapshot()).position, frozenMotion.position, 'pause must also freeze root translation');
  await page.locator('#toggle-follow').click(); await waitTracking();
  await page.locator('#recenter-motion').click(); await page.waitForTimeout(400);
  assert.ok(Math.abs((await motionSnapshot()).position[0]) < 0.015, 'recenter establishes a new image reference at current position');
  await page.locator('#foot-lock').check();
  report.scenarios.push('optional image summary drives bounded root translation through relay; pause freezes root; recenter recalibrates without restarting phone capture');
  await page.screenshot({ path: fileURLToPath(new URL('full-body-motion.png', artifacts)), fullPage: true });
  const footerPage = await browser.newPage({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: insecure });
  await footerPage.route('https://github.com/ehuishou/robot-mimic-studio', route => route.fulfill({ contentType: 'text/html', body: '<title>Repository link target</title>' }));
  for (const path of ['/', '/pose.html', '/mapping.html']) {
    await footerPage.goto(base + path);
    const link = footerPage.locator('footer .repository-link');
    await link.scrollIntoViewIfNeeded(); await link.waitFor({ state: 'visible' });
    assert.equal(await link.count(), 1);
    assert.equal(await link.getAttribute('href'), 'https://github.com/ehuishou/robot-mimic-studio');
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.match(await link.getAttribute('rel'), /noopener/);
    assert.equal(await link.locator('svg').count(), 1);
    assert.equal(await footerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'footer must not cause mobile overflow');
  }
  // Intercept the external response; test the actual popup target without requiring access to a private repository.
  await footerPage.context().route('https://github.com/ehuishou/robot-mimic-studio', route => route.fulfill({ contentType: 'text/html', body: '<title>Repository link target</title>' }));
  const popupPromise = footerPage.waitForEvent('popup');
  await footerPage.locator('footer .repository-link').click();
  const popup = await popupPromise; await popup.waitForLoadState('domcontentloaded');
  assert.equal(popup.url(), 'https://github.com/ehuishou/robot-mimic-studio');
  await popup.close(); await footerPage.close();
  report.scenarios.push('all three page footers show accessible GitHub icon/link without mobile overflow; clicking opens the configured repository in a new tab (external response intercepted)');
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = String(error);
  report.motion = await motionSnapshot().catch(() => null);
  report.joints = await snapshot().catch(() => []);
  console.error(JSON.stringify(report, null, 2));
  throw error;
} finally {
  clearInterval(timer); mobile?.close(); await browser.close();
  await writeFile(new URL('full-body-browser-results.json', artifacts), JSON.stringify(report, null, 2));
}
