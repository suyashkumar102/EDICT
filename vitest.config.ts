import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * vitest config — unit + property + integration tests. Devvit-runtime
 * tests use the official @devvit/test harness via vitest.devvit.config.ts.
 *
 * Coverage gates are tiered:
 *   - Project floor (lines/functions/statements 80, branches 75) catches
 *     accidental deletions of well-tested code.
 *   - Per-file ceilings on security-critical leaves lock the modules
 *     that make irreversible decisions or accept untrusted input.
 *     If any of these slip below threshold, CI fails before deploy.
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
      '@bootstrap': path.resolve(__dirname, 'source/bootstrap'),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts', 'source/**/*.test.ts'],
    exclude: ['node_modules/**', 'distribution/**', 'tests/devvit/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['source/**/*.ts'],
      exclude: [
        'source/**/*.test.ts',
        'source/bootstrap/**',
        'source/interface/customposts/**',
        // Devvit-runtime modules are exercised by the @devvit/test harness,
        // not by Node-based vitest — so excluding them here prevents a
        // false 0% coverage line that would mask real regressions.
        'source/infrastructure/devvit/DevvitProductionAdapter.ts',
        'source/infrastructure/redis/DevvitRedisGateway.ts',
        'source/compilation/llm/OpenAiLLMClient.ts',
      ],
      thresholds: {
        // Project-wide floor.
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,

        // Per-file ceilings on security-critical code. These files make
        // irreversible decisions or parse untrusted input; they must stay
        // near-fully covered. Loosening any of these requires a written
        // rationale in the commit message + a paired exemplar test.
        //
        // RuleSchema.ts: Zod parse + atom-id uniqueness sweep. A regression
        //   here means malformed compiler output reaches the evaluator.
        'source/compilation/schema/RuleSchema.ts': {
          lines: 95,
          functions: 95,
          branches: 95,
          statements: 95,
        },
        // CombinatorAlgebra.ts: AND / OR / NOT short-circuiting + trace
        //   capture. A regression here changes the verdict for the same
        //   fact-bag — silently.
        'source/evaluation/combinators/CombinatorAlgebra.ts': {
          lines: 95,
          functions: 95,
          branches: 95,
          statements: 95,
        },
        // AdaptiveShadowPolicy.ts: Decides when shadow → live promotion
        //   fires. A regression here either prematurely promotes risky
        //   rules or strands them in shadow forever.
        'source/domain/policies/AdaptiveShadowPolicy.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        // CircuitBreakerPolicy.ts: Halts a runaway rule before it spam-
        //   removes a hot thread. The kill-switch is meaningless if its
        //   trip-detection has a bug.
        'source/domain/policies/CircuitBreakerPolicy.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
      },
    },
  },
});
