// MyTasker — Vite config.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { resolve } from 'node:path';
import solid from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [solid()],
  resolve: {
    alias: { '~': resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8015', changeOrigin: false },
      '/backend-static': { target: 'http://127.0.0.1:8015', changeOrigin: false },
      '/ws': { target: 'ws://127.0.0.1:8015', ws: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          solid: ['solid-js', '@solidjs/router'],
          icons: ['lucide-solid'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    server: { deps: { inline: [/solid-js/, /@solidjs/] } },
  },
});
