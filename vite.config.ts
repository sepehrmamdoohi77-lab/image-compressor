import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Allow sandboxed/proxied preview hosts (leading dot = any subdomain).
    allowedHosts: ['.e2b.app', '.arena.ai', 'localhost'],
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: ['.e2b.app', '.arena.ai', 'localhost'],
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2020',
  },
  test: undefined,
});
