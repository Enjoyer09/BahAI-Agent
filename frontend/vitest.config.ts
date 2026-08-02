import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // Same alias as vite.config.ts — shared wire contract single source of truth.
      '@bahai/shared': path.resolve(__dirname, '../shared/contract.js'),
    },
  },
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    css: true,
  },
});
