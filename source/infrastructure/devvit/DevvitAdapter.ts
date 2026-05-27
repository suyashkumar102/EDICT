import type { ActionVerdict } from '@domain/values/ActionVerdict';
import type { SubredditId, ThingId, RuleId } from '@shared/types/BrandedPrimitives';
import type { WhatIfReport } from '@analytics/WhatIfStudio';
import type { DecisionExplanation } from '@evaluation/explain/ExplanationTrace';

/**
 * DevvitAdapter is the seam between EDICT's domain layer and Reddit's
 * platform APIs. Every action that touches a real post/comment goes
 * through here, so the rest of the codebase remains testable without
 * a Devvit runtime.
 *
 * The adapter is implemented by `buildDevvitProductionAdapter` (production)
 * or `buildFakeDevvitAdapter` (tests). Both implement this interface.
 */

export interface DevvitAdapter {
  executeAction(subreddit: SubredditId, thingId: ThingId, verdict: ActionVerdict): Promise<void>;

  ensureCommandCenterPostUrl(subreddit: string): Promise<string>;
  ensureGalleryPostUrl(subreddit: string): Promise<string>;
  ensureBriefingPostUrl(subreddit: string): Promise<string>;

  findExplanationForThing(subreddit: string, thingId: string): Promise<DecisionExplanation | null>;

  cacheWhatIfReport(subreddit: SubredditId, ruleId: RuleId, report: WhatIfReport): Promise<void>;
  readCachedWhatIfReport(subreddit: SubredditId, ruleId: RuleId): Promise<WhatIfReport | null>;

  seedOnInstall(subreddit: SubredditId): Promise<void>;
}

/**
 * Skeleton fake adapter used by tests and by the offline replay tool.
 * Returns deterministic, no-op responses.
 */
export const buildFakeDevvitAdapter = (): DevvitAdapter => {
  const cache = new Map<string, WhatIfReport>();
  return {
    async executeAction() {
      /* no-op */
    },
    async ensureCommandCenterPostUrl(subreddit) {
      return `https://reddit.com/r/${subreddit}/comments/aegis-command-center`;
    },
    async ensureGalleryPostUrl(subreddit) {
      return `https://reddit.com/r/${subreddit}/comments/aegis-gallery`;
    },
    async ensureBriefingPostUrl(subreddit) {
      return `https://reddit.com/r/${subreddit}/comments/aegis-briefing`;
    },
    async findExplanationForThing() {
      return null;
    },
    async cacheWhatIfReport(subreddit, ruleId, report) {
      cache.set(`${subreddit}:${ruleId}`, report);
    },
    async readCachedWhatIfReport(subreddit, ruleId) {
      return cache.get(`${subreddit}:${ruleId}`) ?? null;
    },
    async seedOnInstall() {
      /* no-op */
    },
  };
};

/**
 * The production implementation lives in `DevvitProductionAdapter.ts`. It
 * is imported directly from `Bootstrap.ts` rather than re-exported here,
 * so test code that pulls the fake adapter never side-effect-loads the
 * `@devvit/web/server` import that would fail outside the Devvit runtime.
 */
