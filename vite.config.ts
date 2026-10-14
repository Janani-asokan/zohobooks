import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:4000', changeOrigin: false } } },
  preview: { proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:4000', changeOrigin: false } } },
  build: {
    rollupOptions: {
      output: { manualChunks: { react: ['react', 'react-dom', 'react-router-dom'], query: ['@tanstack/react-query'] } },
    },
  },
});
