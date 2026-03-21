import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/test/integration/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: ['node_modules/**', 'dist/**'],
    testTimeout: 60000,
    hookTimeout: 60000,
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@test': resolve(__dirname, './src/test'),
      // Map @perfana/shared imports to source files instead of dist (for tests)
      '@perfana/shared': resolve(__dirname, '../../packages/shared/src'),
      '@perfana/shared/entities': resolve(__dirname, '../../packages/shared/src/entities/index.ts'),
    }
  }
});