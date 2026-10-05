import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/arena/' : '/',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/arena/api': { target: 'http://127.0.0.1:8000', changeOrigin: false },
      '/arena/ws': { target: 'ws://127.0.0.1:8000', ws: true, changeOrigin: false },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: { output: { manualChunks: { 'render-core': ['three'] } } },
  },
}));
