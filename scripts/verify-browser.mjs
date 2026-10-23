import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const baseURL = process.env.TEST_URL || 'http://127.0.0.1:5173';
const artifacts = new URL('../artifacts/', import.meta.url);
await mkdir(artifacts, { recursive: true });

function fixtureGLB(withRig = true) {
  const bytes = Buffer.alloc(144);
  [-0.5, 0, 0, 0.5, 0, 0, 0, 2, 0].forEach((value, i) => bytes.writeFloatLE(value, i * 4));
  for (let i = 0; i < 3; i++) {
    bytes.writeFloatLE(1, 36 + i * 12 + 8);
    bytes.writeFloatLE(1, 96 + i * 16);
  }
  const gltf = {
    asset: { version: '2.0', generator: 'Robot Studio browser fixture' },
    scene: 0, scenes: [{ nodes: [0] }],
    nodes: withRig ? [
      { name: 'FixtureArmature', children: [1, 4] },
      { name: 'ActualRoot', children: [2] },
      { name: 'CustomElbow', translation: [0, 1, 0], children: [3] },
      { name: 'CustomWrist', translation: [0, 0.5, 0] }, { mesh: 0, skin: 0 },
    ] : [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: withRig ? { POSITION: 0, NORMAL: 1, JOINTS_0: 2, WEIGHTS_0: 3 } : { POSITION: 0, NORMAL: 1 }, material: 0 }] }],
    materials: [{ doubleSided: true }], buffers: [{ byteLength: bytes.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 36 },
      { buffer: 0, byteOffset: 72, byteLength: 24 }, { buffer: 0, byteOffset: 96, byteLength: 48 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-0.5, 0, 0], max: [0.5, 2, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: 3, type: 'VEC4' },
      { bufferView: 3, componentType: 5126, count: 3, type: 'VEC4' },
    ], ...(withRig ? { skins: [{ joints: [1, 2, 3] }] } : {}),
  };
  let json = Buffer.from(JSON.stringify(gltf));
  json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const result = Buffer.alloc(28 + json.length + bytes.length);
  result.writeUInt32LE(0x46546c67, 0); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(json.length, 12); result.writeUInt32LE(0x4e4f534a, 16); json.copy(result, 20);
  const offset = 20 + json.length;
  result.writeUInt32LE(bytes.length, offset); result.writeUInt32LE(0x004e4942, offset + 4); bytes.copy(result, offset + 8);
  return result;
}

const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || undefined, args: ['--enable-unsafe-swiftshader'] });
const results = [], errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text()); });
  const ready = async () => {
    await page.waitForFunction(() => document.getElementById('loading')?.hidden === true);
    assert.equal(await page.locator('#scene-error').isVisible(), false);
    assert.equal(await page.locator('#viewport canvas').count(), 1);
  };
  await page.route('**/models/robot.glb', (route) => route.fulfill({ status: 404, body: 'Not found' }));
  await page.goto(baseURL); await ready();
  assert.equal(await page.locator('#bone-count').textContent(), '17');
  assert.match(await page.locator('#model-notice').textContent(), /内置机器人/);
  await page.waitForFunction(() => Number(document.getElementById('fps')?.textContent) > 0);
  await page.screenshot({ path: fileURLToPath(new URL('desktop.png', artifacts)), fullPage: true });
  const before = await page.locator('#viewport canvas').screenshot();
  await page.getByRole('button', { name: 'LeftUpperArm', exact: true }).click();
  await page.locator('#rotation-z').evaluate((input) => { input.value = '70'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await page.locator('#value-z').textContent(), '70°');
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.ok(!before.equals(await page.locator('#viewport canvas').screenshot()), 'rotation changes rendered pixels');
  await page.locator('#reset-pose').click();
  assert.equal(await page.locator('#value-z').textContent(), '0°');
  assert.match(await page.locator('#action-status').textContent(), /恢复初始姿势/);
  await page.locator('#bone-search').fill('nonexistent');
  assert.match(await page.locator('#bone-list').textContent(), /没有匹配/);
  await page.locator('#bone-search').fill('Head'); assert.equal(await page.locator('.bone-item').count(), 1);
  await page.getByRole('button', { name: 'Head', exact: true }).click();
  assert.equal(await page.locator('#selected-name').textContent(), 'Head'); await page.locator('#bone-search').fill('');
  for (const id of ['toggle-grid', 'toggle-skeleton', 'toggle-rotate']) {
    const prior = await page.locator(`#${id}`).getAttribute('aria-pressed');
    await page.locator(`#${id}`).click(); assert.notEqual(await page.locator(`#${id}`).getAttribute('aria-pressed'), prior);
    await page.locator(`#${id}`).click();
  }
  await page.getByRole('button', { name: '正面', exact: true }).click(); await page.locator('#reset-camera').click();
  assert.match(await page.locator('[data-view="perspective"]').getAttribute('class'), /active/);
  results.push('missing GLB: fallback renders, 17 bones, rotation/reset/search/view toggles pass');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.screenshot({ path: fileURLToPath(new URL('mobile.png', artifacts)), fullPage: true });
  results.push('390px mobile layout: no horizontal overflow, screenshot captured');
  await page.unroute('**/models/robot.glb');
  await page.route('**/models/robot.glb', (route) => route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: fixtureGLB(true) }));
  await page.reload(); await ready();
  assert.equal(await page.locator('#source-badge').textContent(), 'GLB 模型');
  assert.equal(await page.locator('#bone-count').textContent(), '03');
  assert.deepEqual(await page.locator('.bone-name').allTextContents(), ['ActualRoot', 'CustomElbow', 'CustomWrist']);
  await page.getByRole('button', { name: 'CustomElbow', exact: true }).click();
  assert.equal(await page.locator('#selected-name').textContent(), 'CustomElbow');
  results.push('valid synthetic GLB: real skin/bone names loaded');
  await page.unroute('**/models/robot.glb');
  await page.route('**/models/robot.glb', (route) => route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: fixtureGLB(false) }));
  await page.reload(); await ready();
  assert.equal(await page.locator('#source-badge').textContent(), 'GLB 模型');
  assert.equal(await page.locator('#bone-count').textContent(), '00');
  assert.equal(await page.locator('#reset-pose').isDisabled(), true);
  assert.equal(await page.locator('#rotation-x').isDisabled(), true);
  results.push('unrigged GLB: model displays with disabled joint controls');
  await page.unroute('**/models/robot.glb');
  await page.route('**/models/robot.glb', (route) => route.fulfill({ status: 200, body: '<html>not a glb</html>' }));
  await page.reload(); await ready();
  assert.equal(await page.locator('#bone-count').textContent(), '17');
  assert.match(await page.locator('#model-notice').textContent(), /有效的 GLB/);
  results.push('invalid model: warning and functional fallback');
  await page.locator('#viewport canvas').dispatchEvent('webglcontextlost');
  assert.match(await page.locator('#scene-error').textContent(), /图形上下文已丢失/);
  results.push('WebGL context loss: recovery message');
  assert.deepEqual(errors, [], 'no unexpected console or runtime errors');
  await context.close();
} finally { await browser.close(); }
await writeFile(new URL('browser-results.json', artifacts), JSON.stringify({ baseURL, results, unexpectedErrors: errors }, null, 2));
for (const result of results) console.log(`PASS ${result}`);
console.log('PASS no unexpected browser errors');
