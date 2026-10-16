import { defineConfig } from 'vitest/config'
import path from 'path'

// Database tests: a temporary Postgres 17 started by tests/db/global-setup.ts
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/db/**/*.test.ts'],
    globalSetup: ['tests/db/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
