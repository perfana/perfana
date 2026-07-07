import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules/**', 'dist/**'],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@perfana/shared': resolve(__dirname, './src'),
      '@perfana/shared/entities': resolve(__dirname, './src/entities/index.ts'),
    },
  },
});
