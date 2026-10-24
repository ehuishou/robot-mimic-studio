import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  server: {
    host: '0.0.0.0',
    proxy: {
      // Keep the relay's strict same-origin check valid behind the dev proxy.
      '/api': { target: 'http://127.0.0.1:8082', changeOrigin: true, headers: { origin: 'http://127.0.0.1:8082' } },
      '/ws': { target: 'ws://127.0.0.1:8082', ws: true, changeOrigin: true, headers: { origin: 'http://127.0.0.1:8082' } },
    },
  },
  preview: { host: '0.0.0.0' },
  build: {
    target: 'es2022',
    rolldownOptions: { input: { studio: fileURLToPath(new URL('./index.html', import.meta.url)), pose: fileURLToPath(new URL('./pose.html', import.meta.url)), mapping: fileURLToPath(new URL('./mapping.html', import.meta.url)) } },
  },
});
