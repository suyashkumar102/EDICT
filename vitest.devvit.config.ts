import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Vitest config for the `@devvit/test` harness. Runs the same test files
 * but with the real Devvit Web runtime injected — used to verify that
 * trigger payloads, menu endpoints, and form submissions parse exactly
 * the way Devvit produces them.
 *
 * The harness is slower than the in-process vitest run, so it's split
 * into its own command (`npm run verify:devvit`).
 */
export default defineConfig({
  resolve: {
    alias: {
      '@domain': path.resolve(__dirname, 'source/domain'),
      '@compilation': path.resolve(__dirname, 'source/compilation'),
      '@evaluation': path.resolve(__dirname, 'source/evaluation'),
      '@orchestration': path.resolve(__dirname, 'source/orchestration'),
      '@safety': path.resolve(__dirname, 'source/safety'),
      '@analytics': path.resolve(__dirname, 'source/analytics'),
      '@infrastructure': path.resolve(__dirname, 'source/infrastructure'),
      '@interface': path.resolve(__dirname, 'source/interface'),
      '@shared': path.resolve(__dirname, 'source/shared'),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/devvit/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
