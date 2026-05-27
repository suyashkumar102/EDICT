#!/usr/bin/env tsx
/**
 * End-to-end compiler smoketest against a real LLM provider.
 *
 * Runs each canonical sentence through CompilerService, asserts the
 * output parses through `compiledRuleSchema` and produces the expected
 * verdict kind. Prints a model-comparison table at the end.
 *
 * Provider:
 *   --provider openai   (default)
 *   --provider gemini
 *
 * Requires OPENAI_API_KEY or GEMINI_API_KEY in `.env` depending on
 * provider. Skip this in CI; run manually before bumping the compiler
 * model in `devvit.json`.
 *
 * Usage:
 *   npm run compile:smoketest
 *   npm run compile:smoketest -- --model gpt-5.4-nano
 *   npm run compile:smoketest -- --provider gemini
 *   npm run compile:smoketest -- --provider gemini --model gemini-2.5-flash
 *   npm run compile:smoketest -- --all      # cycle every model for current provider
 */
import 'dotenv/config';
import { buildCompilerService, type LLMPort } from '../source/compilation/llm/CompilerService';
import { buildOpenAiLLMClient } from '../source/compilation/llm/OpenAiLLMClient';
import { buildGeminiLLMClient } from '../source/compilation/llm/GeminiLLMClient';

interface Probe {
  readonly name: string;
  readonly english: string;
  readonly expectedVerdictKind: string;
  readonly expectedClauseCount: number;
}

const PROBES: readonly Probe[] = [
  {
    name: 'single-atom-lock',
    english: 'Lock any post whose title is in all caps.',
    expectedVerdictKind: 'lock',
    expectedClauseCount: 1,
  },
  {
    name: 'and-two-atoms',
    english: 'Send to mod queue any post under 50 characters from accounts less than 7 days old.',
    expectedVerdictKind: 'sendToModQueue',
    expectedClauseCount: 1,
  },
  {
    name: 'or-three-domains',
    english: 'Report posts that contain a link to bit.ly or tinyurl.com or t.co.',
    expectedVerdictKind: 'report',
    expectedClauseCount: 1,
  },
  {
    name: 'when-unless',
    english:
      'Send to mod queue any post with 3 or more unique reporters, unless the author has positive karma above 1000.',
    expectedVerdictKind: 'sendToModQueue',
    expectedClauseCount: 1,
  },
  {
    name: 'multi-clause-tiered',
    english:
      'If a post is under 30 chars send to mod queue. If it is also from an account younger than 24 hours, flair it as "new-user-low-effort". And if its title is in all caps, lock it.',
    expectedVerdictKind: 'lock',
    expectedClauseCount: 3,
  },
];

const OPENAI_MODELS = ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano'];
const GEMINI_MODELS = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];

const flagValue = (flag: string): string | undefined => {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
};

const provider = (flagValue('--provider') ?? 'openai') as 'openai' | 'gemini';

const envKey = provider === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY';
const apiKey = process.env[envKey];
if (!apiKey) {
  // eslint-disable-next-line no-console
  console.error(`Set ${envKey} in .env to run the smoketest.`);
  process.exit(1);
}

const defaultModel = provider === 'gemini' ? 'gemini-2.5-flash' : 'gpt-5.4-mini';
const runAll = process.argv.includes('--all');
const models = runAll
  ? provider === 'gemini'
    ? GEMINI_MODELS
    : OPENAI_MODELS
  : [flagValue('--model') ?? defaultModel];

const buildClient = (): LLMPort =>
  provider === 'gemini' ? buildGeminiLLMClient({ apiKey }) : buildOpenAiLLMClient({ apiKey });

const compiler = buildCompilerService(buildClient());

interface RunResult {
  readonly model: string;
  readonly passed: number;
  readonly total: number;
  readonly avgMs: number;
}

const runs: RunResult[] = [];

for (const model of models) {
  // eslint-disable-next-line no-console
  console.log(`\n— provider: ${provider} · model: ${model} —`);
  let passed = 0;
  let failed = 0;
  const timings: number[] = [];

  for (const probe of PROBES) {
    const started = Date.now();
    try {
      const result = await compiler.compile({
        englishSource: probe.english,
        title: probe.name,
        description: 'compiler smoketest',
        optInActions: new Set(),
        priorClarifications: [],
        model,
        verbosity: 'balanced',
      });
      const elapsed = Date.now() - started;
      timings.push(elapsed);
      const ok =
        result.rule.clauses.length === probe.expectedClauseCount &&
        result.rule.clauses.some((c) => c.verdict.kind === probe.expectedVerdictKind);
      if (ok) {
        passed += 1;
        // eslint-disable-next-line no-console
        console.log(`  ✓ ${probe.name} (${elapsed}ms, conf=${result.confidence.toFixed(2)})`);
      } else {
        failed += 1;
        // eslint-disable-next-line no-console
        console.error(
          `  ✗ ${probe.name} — expected ${probe.expectedClauseCount} clause(s) with ${probe.expectedVerdictKind}`,
        );
      }
    } catch (err) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.error(`  ✗ ${probe.name} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const avgMs = Math.round(timings.reduce((a, b) => a + b, 0) / Math.max(1, timings.length));
  runs.push({ model, passed, total: PROBES.length, avgMs });
  // eslint-disable-next-line no-console
  console.log(
    `${passed}/${PROBES.length} passed · avg=${avgMs}ms${failed > 0 ? ` · ${failed} failed` : ''}`,
  );
}

if (runs.length > 1) {
  // eslint-disable-next-line no-console
  console.log('\n— summary —');
  for (const r of runs) {
    // eslint-disable-next-line no-console
    console.log(`  ${r.model.padEnd(24)}  ${r.passed}/${r.total}  ${r.avgMs}ms`);
  }
}

const allPassed = runs.every((r) => r.passed === r.total);
process.exit(allPassed ? 0 : 1);
