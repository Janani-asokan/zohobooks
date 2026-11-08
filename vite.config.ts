import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // The phone app draws under the status bar and home bar and keeps clear of them itself (safe-area insets in CSS).
    mode === 'app' && { name: 'app-viewport', transformIndexHtml: (html: string) => html.replace('initial-scale=1.0"', 'initial-scale=1.0, viewport-fit=cover"') },
  ],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:4000', changeOrigin: false } } },
  preview: { proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:4000', changeOrigin: false } } },
  build: {
    rollupOptions: {
      output: { manualChunks: { react: ['react', 'react-dom', 'react-router-dom'], query: ['@tanstack/react-query'] } },
    },
  },
}));
