#!/usr/bin/env tsx
/**
 * Offline event replay. Reads a fixture event log from
 * `tests/fixtures/sample.events.json` and replays it through the
 * full projection + evaluator pipeline, using the in-memory Redis
 * gateway and the fake LLM client.
 *
 * Useful for:
 *   - reproducing a bug locally without a Devvit runtime
 *   - testing changes to the evaluator against historical data
 *   - benchmarking the hot path
 *
 * Usage:
 *   npm run replay
 *   npm run replay -- path/to/your-events.json
 */
import { readFileSync } from 'node:fs';
import { composeRoot, defaultSettings } from '../source/bootstrap/CompositionRoot';
import type { DomainEvent } from '../source/domain/events/DomainEvent';

const inputPath = process.argv[2] ?? 'tests/fixtures/sample.events.json';

let events: DomainEvent[];
try {
  events = JSON.parse(readFileSync(inputPath, 'utf-8')) as DomainEvent[];
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(`Failed to read ${inputPath}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const root = composeRoot({ settings: defaultSettings() });
let appended = 0;
let projected = 0;

for (const event of events) {
  await root.events.append(event);
  appended += 1;
  await root.eventDispatcher.dispatch(event);
  projected += 1;
}

const sub = events[0]?.subreddit;
if (!sub) {
  // eslint-disable-next-line no-console
  console.error('No events to replay.');
  process.exit(1);
}

const view = await root.activeRules.readActive(sub);
// eslint-disable-next-line no-console
console.log(
  `Replay complete · ${appended} events appended · ${projected} dispatched · ${view.rules.length} rules visible`,
);
for (const rule of view.rules) {
  // eslint-disable-next-line no-console
  console.log(
    `  - ${rule.id} v${rule.currentVersion} [${rule.shadowStatus.phase}] "${rule.title}"`,
  );
}
