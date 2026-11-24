import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // The phone app draws under the status bar and home bar and keeps clear of them itself (safe-area insets in CSS).
    // The list of every script and style of the app, so the service worker can keep them all once someone signs in:
    // then any screen opens without internet, not only the ones already visited (public/sw.js, "precache").
    {
      name: 'offline-precache', apply: 'build' as const,
      generateBundle(_o: unknown, bundle: Record<string, { fileName: string }>) {
        const files = Object.values(bundle).map((f) => f.fileName).filter((f) => f.startsWith('assets/') && /\.(js|css|woff2?)$/.test(f) && !/vosk/i.test(f)).map((f) => `/${f}`); // vosk: the Windows app's speech engine, loaded there only
        (this as unknown as { emitFile: (f: { type: 'asset'; fileName: string; source: string }) => void }).emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify(files) });
      },
    },
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
