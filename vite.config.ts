import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  server: { host: '0.0.0.0' },
  preview: { host: '0.0.0.0' },
  build: {
    target: 'es2022',
    rolldownOptions: { input: { studio: fileURLToPath(new URL('./index.html', import.meta.url)), pose: fileURLToPath(new URL('./pose.html', import.meta.url)) } },
  },
});
