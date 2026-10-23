import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  server: { host: '0.0.0.0' },
  preview: { host: '0.0.0.0' },
  build: { target: 'es2022' },
});
