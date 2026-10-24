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
  await page.waitForFunction(() => document.getElementById('app').dataset.ready === 'true');
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
    send({ type: 'pose', version: 1, room, sessionId, timestamp, seq: ++seq, landmarks: simulatedPose(mode, timestamp, seq).worldLandmarks });
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
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  clearInterval(timer); mobile?.close(); await browser.close();
  await writeFile(new URL('full-body-browser-results.json', artifacts), JSON.stringify(report, null, 2));
}
