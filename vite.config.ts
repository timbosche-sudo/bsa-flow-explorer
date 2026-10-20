/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// Production builds are served from GitHub Pages at /<repo>/.
// Override with BASE_PATH (e.g. BASE_PATH=/ for other hosts).
const PAGES_BASE = '/bsa-flow-explorer/';

export default defineConfig(({ command }) => ({
  base: process.env.BASE_PATH ?? (command === 'build' ? PAGES_BASE : '/'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  worker: { format: 'es' },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          pdfjs: ['pdfjs-dist'],
          charts: ['recharts'],
          react: ['react', 'react-dom', 'zustand'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}));
