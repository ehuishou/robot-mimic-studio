import { createServer } from 'node:http';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream';
import { createServer as createSecureServer } from 'node:https';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachRelay } from './runtime/relay.mjs';

const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const acmeRoot = resolve(process.env.ACME_ROOT || '/var/lib/robot-studio-acme');
const tls = process.env.TLS_CERT && process.env.TLS_KEY ? {
  cert: readFileSync(process.env.TLS_CERT), key: readFileSync(process.env.TLS_KEY), minVersion: 'TLSv1.2',
} : undefined;
const httpsOrigin = process.env.PUBLIC_HTTPS_ORIGIN;
if (tls && httpsOrigin && !/^https:\/\/[^/?#]+$/.test(httpsOrigin)) throw new Error('PUBLIC_HTTPS_ORIGIN must be an HTTPS origin');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.wasm': 'application/wasm', '.task': 'application/octet-stream' };
function sendFile(request, response, path, cache = 'no-cache') {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) throw new Error('Not a file');
    const acceptsGzip = String(request.headers['accept-encoding'] || '').split(',').some(value => {
      const [encoding, ...parameters] = value.trim().split(';');
      const quality = parameters.find(parameter => parameter.trim().startsWith('q='));
      return encoding === 'gzip' && (!quality || Number(quality.trim().slice(2)) > 0);
    });
    const compressed = stat.size >= 1024 && acceptsGzip && ['.html', '.js', '.css', '.json', '.svg', '.glb', '.wasm', '.task'].includes(extname(path));
    response.writeHead(200, {
      'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': cache,
      Vary: 'Accept-Encoding', ...(compressed ? { 'Content-Encoding': 'gzip' } : { 'Content-Length': stat.size }),
    });
    if (request.method === 'HEAD') { response.end(); return; }
    const stream = createReadStream(path);
    const finish = error => { if (error) response.destroy(); };
    if (compressed) pipeline(stream, createGzip(), response, finish);
    else pipeline(stream, response, finish);
  } catch { response.writeHead(404); response.end('Not found'); }
}
function handler(request, response) {
  if (response.writableEnded) return;
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  if (!['GET', 'HEAD'].includes(request.method || '')) {
    response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return;
  }
  let url, pathname;
  try { url = new URL(request.url, 'http://localhost'); pathname = decodeURIComponent(url.pathname); }
  catch { response.writeHead(400); response.end('Bad request'); return; }
  if (/^\/\.well-known\/acme-challenge\/[A-Za-z0-9_-]+$/.test(pathname)) {
    sendFile(request, response, resolve(acmeRoot, '.' + pathname)); return;
  }
  if (tls && httpsOrigin && !request.socket.encrypted) {
    response.writeHead(308, { Location: httpsOrigin + url.pathname + url.search }); response.end(); return;
  }
  const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!path.startsWith(root + sep)) { response.writeHead(403); response.end('Forbidden'); return; }
  sendFile(request, response, path, pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
}
const servers = [createServer(handler)];
if (tls) servers.push(createSecureServer(tls, handler));
attachRelay(servers);
for (const [index, server] of servers.entries()) {
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  const port = Number(index ? process.env.TLS_PORT || 443 : process.env.PORT || 8082);
  server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`Robot Studio ${index ? 'HTTPS' : 'HTTP'} listening on port ${port}`));
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  for (const server of servers) { server.close(); server.closeIdleConnections(); }
  setTimeout(() => process.exit(0), 5000).unref();
});
