import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('node_modules/@mediapipe/tasks-vision/package.json', root), 'utf8'));
if (pkg.version !== '1.1.1') throw new Error('MediaPipe version changed: update the reviewed resource configuration first.');
const source = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const expected = '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a';
const sha = (data) => createHash('sha256').update(data).digest('hex');
const modelPath = new URL('public/mediapipe/models/pose_landmarker_lite.task', root);
await mkdir(new URL('./', modelPath), { recursive: true });
let bytes;
try { bytes = await readFile(modelPath); } catch { /* Download below. */ }
if (!bytes || sha(bytes) !== expected) {
  console.log('Downloading official Pose Landmarker Lite float16/1…');
  const response = await fetch(source, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
  if (sha(bytes) !== expected) throw new Error('Model SHA-256 mismatch; refusing to publish.');
  await writeFile(modelPath, bytes);
}
await mkdir(new URL('public/mediapipe/wasm/', root), { recursive: true });
const files = {};
for (const name of ['vision_wasm_internal', 'vision_wasm_nosimd_internal', 'vision_wasm_module_internal']) {
  for (const ext of ['js', 'wasm']) {
    const filename = `${name}.${ext}`;
    const from = new URL(`node_modules/@mediapipe/tasks-vision/wasm/${filename}`, root);
    const to = new URL(`public/mediapipe/wasm/${filename}`, root);
    await copyFile(from, to);
    files[filename] = sha(await readFile(to));
  }
}
await writeFile(new URL('public/mediapipe/wasm/manifest.json', root), JSON.stringify({ version: pkg.version, files }, null, 2) + '\n');
console.log(`Pose resources ready: MediaPipe ${pkg.version}, model ${bytes.length} bytes, SHA-256 ${expected}`);
console.log(fileURLToPath(modelPath));
