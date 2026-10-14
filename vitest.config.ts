import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    include: ['shared/**/*.test.ts', 'server/test/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false, // API tests share one test database
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://ledgerly:ledgerly@localhost:5432/ledgerly_test',
      MIGRATIONS_DIR: path.resolve(__dirname, 'server/migrations'),
    },
  },
});
