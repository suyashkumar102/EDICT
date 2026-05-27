// vite.config.ts — builds EDICT's Devvit Web server bundle.
//
// Devvit's serverless runtime exposes Node built-ins ONLY. Every npm
// dependency the server uses (@devvit/web, @hono/node-server, hono,
// zod, …) has to be bundled into the single `Bootstrap.cjs` artifact.
// Marking `@devvit/web/server` as external — like an earlier revision
// did — causes "Cannot find module '@devvit/web/server'" at install
// time, because the Devvit runtime doesn't resolve that path itself.
//
// Pattern below mirrors the working vibe-mod build: SSR mode + the
// rollup `external` list narrowed to Node built-ins only. CJS output
// is mandatory; the Devvit Web runtime does not load ESM server bundles.

import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@bootstrap': path.resolve(__dirname, 'source/bootstrap'),
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
    conditions: ['default', 'node'],
  },
  ssr: {
    // Bundle every npm dep (@devvit/web, @hono/node-server, hono, …) into
    // the server bundle; only Node built-ins stay external.
    noExternal: true,
  },
  build: {
    target: 'node22',
    outDir: 'distribution/server',
    emptyOutDir: true,
    ssr: 'source/bootstrap/Bootstrap.ts',
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
      output: {
        format: 'cjs',
        entryFileNames: 'Bootstrap.cjs',
      },
    },
    sourcemap: true,
    minify: false,
  },
});
