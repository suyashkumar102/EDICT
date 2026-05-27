import { Hono } from 'hono';
import { reddit } from '@devvit/web/server';
import type { CompositionRoot } from '@bootstrap/CompositionRoot';
import {
  brandRuleVersion,
  brandSubredditId,
  brandThingId,
  brandTimestampMs,
  brandULID,
} from '@shared/types/BrandedPrimitives';
import { getCurrentSubredditName } from '@interface/middleware/DevvitContext';
import { mintUlid } from '@shared/utilities/Ulid';
import {
  buildFactBag,
  factsReferencedBy,
  type RedditSnapshot,
} from '@evaluation/factbag/FactBagBuilder';
import { evaluateRuleSet } from '@evaluation/RuleEvaluator';
import { latestClauses } from '@domain/aggregates/RuleAggregate';
import type { CompiledRule } from '@compilation/schema/RuleSchema';
import { fingerprintFromEvaluation } from '@safety/UndoLearningStrategy';
import { CircuitBreakerOpen } from '@shared/errors/DomainError';
import type { DomainEvent } from '@domain/events/DomainEvent';

/**
 * Map Devvit's PostSubmit / CommentSubmit trigger payload into EDICT's
 * RedditSnapshot. Devvit delivers PostV2-shaped objects; we extract the
 * fields the FactBagBuilder reads, fetch the author's karma + age via
 * `reddit.getUserById`, and derive what we can statically from the
 * payload alone.
 *
 * Anything we can't measure cheaply (banned-in-other-sub history,
 * post-score-after-N-minutes, etc.) gets a safe default that won't
 * spuriously match: 0 for counters, false for booleans, [] for arrays.
 * The atom evaluators short-circuit to "not measurable" when slots are
 * missing, so missing data fails closed rather than firing aggressive
 * rules on incomplete signal.
 */

interface DevvitPostPayload {
  post?: {
    id?: string;
    title?: string;
    selftext?: string;
    body?: string;
    url?: string;
    nsfw?: boolean;
    linkFlair?: { text?: string };
    crosspostParentId?: string;
    createdAt?: string | number;
  };
  comment?: {
    id?: string;
    body?: string;
    parentId?: string;
    postId?: string;
  };
  author?: {
    id?: string;
    name?: string;
    flair?: { text?: string };
  };
  subreddit?: { id?: string; name?: string };
}

const URL_DOMAIN_RE = /https?:\/\/([^/?#\s]+)/gi;

const extractDomains = (text: string): readonly string[] => {
  const domains: string[] = [];
  const matches = text.matchAll(URL_DOMAIN_RE);
  for (const m of matches) {
    const host = m[1];
    if (host) domains.push(host.toLowerCase().replace(/^www\./, ''));
  }
  return domains;
};

const fetchAuthorInfo = async (
  authorId: string | undefined,
  authorName: string | undefined,
): Promise<{ karma: number; accountCreatedAtMs: number; verifiedEmail: boolean }> => {
  const fallback = { karma: 0, accountCreatedAtMs: Date.now(), verifiedEmail: false };
  if (!authorId && !authorName) return fallback;
  try {
    const user = authorName
      ? await reddit.getUserByUsername(authorName)
      : await reddit.getUserById(authorId as `t2_${string}`);
    if (!user) return fallback;
    return {
      karma: (user.linkKarma ?? 0) + (user.commentKarma ?? 0),
      accountCreatedAtMs: user.createdAt ? new Date(user.createdAt).getTime() : Date.now(),
      verifiedEmail: (user as { hasVerifiedEmail?: boolean }).hasVerifiedEmail ?? false,
    };
  } catch (err) {
    console.warn('[edict] fetchAuthorInfo failed:', String(err));
    return fallback;
  }
};

const buildPostSnapshot = async (raw: DevvitPostPayload): Promise<RedditSnapshot | null> => {
  const post = raw.post;
  if (!post?.id || !post.title) return null;
  const body = post.selftext ?? post.body ?? '';
  const url = post.url ?? '';
  const linkText = `${body} ${url}`.trim();
  const domains = extractDomains(linkText);
  const hasLink = domains.length > 0 || /\bhttps?:\/\//.test(linkText);

  const authorInfo = await fetchAuthorInfo(raw.author?.id, raw.author?.name);
  const postedAtMs = post.createdAt ? new Date(post.createdAt).getTime() : Date.now();

  return {
    kind: 'post',
    thingId: brandThingId(post.id),
    capturedAt: Date.now(),
    title: post.title,
    body,
    authorKarma: authorInfo.karma,
    accountCreatedAtMs: authorInfo.accountCreatedAtMs,
    authorVerifiedEmail: authorInfo.verifiedEmail,
    ...(raw.author?.flair?.text ? { authorFlair: raw.author.flair.text } : {}),
    authorHasModMail: false,
    authorBannedInOtherSubInLastDays: 0,
    hasLink,
    linkDomains: domains,
    reportCount: 0,
    uniqueReporterCount: 0,
    isSelfPost: !!body && !url,
    isCrosspost: !!post.crosspostParentId,
    postedAtMs,
  };
};

const buildCommentSnapshot = async (raw: DevvitPostPayload): Promise<RedditSnapshot | null> => {
  const comment = raw.comment;
  if (!comment?.id) return null;
  const body = comment.body ?? '';
  const domains = extractDomains(body);

  const authorInfo = await fetchAuthorInfo(raw.author?.id, raw.author?.name);

  return {
    kind: 'comment',
    thingId: brandThingId(comment.id),
    capturedAt: Date.now(),
    title: '',
    body,
    authorKarma: authorInfo.karma,
    accountCreatedAtMs: authorInfo.accountCreatedAtMs,
    authorVerifiedEmail: authorInfo.verifiedEmail,
    ...(raw.author?.flair?.text ? { authorFlair: raw.author.flair.text } : {}),
    authorHasModMail: false,
    authorBannedInOtherSubInLastDays: 0,
    hasLink: domains.length > 0,
    linkDomains: domains,
    reportCount: 0,
    uniqueReporterCount: 0,
    isSelfPost: false,
    isCrosspost: false,
    postedAtMs: Date.now(),
  };
};

/**
 * Trigger routes. Reddit's event system calls these on every post,
 * comment, report, etc. We:
 *   1. build a RedditSnapshot from the trigger payload
 *   2. build a FactBag with the slots the active rules actually read
 *   3. evaluate the rule set
 *   4. if a verdict fires:
 *      - shadowed → write ShadowDecisionRecorded
 *      - live     → check breaker, check undo-learn deflection,
 *                   take action via DevvitAdapter, write ActionTaken,
 *                   mint rollback token
 *
 * The whole hot path is async-await but contains zero LLM calls. The
 * compiler is the *only* place the LLM is invoked; runtime evaluation
 * is pure TS.
 */
export const buildTriggerRoutes = (root: CompositionRoot): Hono => {
  const app = new Hono();

  const handleSubmission = async (
    subredditRaw: string,
    snapshot: RedditSnapshot,
  ): Promise<void> => {
    const subreddit = brandSubredditId(subredditRaw);
    const active = await root.activeRules.readActive(subreddit);
    console.log(`[edict] evaluate: found ${active.rules.length} active rules for ${subredditRaw}`);
    if (active.rules.length === 0) return;

    const factsNeeded = factsReferencedBy(active.rules.map((r) => ({ clauses: latestClauses(r) })));
    const bag = buildFactBag(snapshot, factsNeeded);
    console.log(
      `[edict] evaluate: facts needed = ${[...factsNeeded].join(',')}, bag = ${JSON.stringify(bag)}`,
    );

    const evaluations = active.rules
      .filter((r) => r.shadowStatus.phase === 'shadowed' || r.shadowStatus.phase === 'live')
      .map((r) => ({
        ruleId: r.id,
        rule: {
          schemaVersion: 1 as const,
          title: r.title,
          description: r.description,
          englishSource: '',
          clauses: latestClauses(r) as CompiledRule['clauses'],
          compilerConfidence: 1,
        },
        shadowed: r.shadowStatus.phase === 'shadowed',
      }));

    console.log(
      `[edict] evaluate: evaluating ${evaluations.length} rules. rules=`,
      JSON.stringify(evaluations),
    );

    const outcome = evaluateRuleSet(evaluations, bag);
    console.log(`[edict] evaluate: outcome verdict = ${JSON.stringify(outcome.verdict)}`);
    if (!outcome.verdict) return;

    const now = root.clock.now();
    if (outcome.shadowOnly) {
      const event: DomainEvent = {
        eventId: brandULID(mintUlid(() => now)),
        subreddit,
        occurredAt: now,
        actor: 'system',
        payload: {
          kind: 'ShadowDecisionRecorded',
          ruleId: outcome.verdict.ruleId,
          version: brandRuleVersion(1),
          thingId: snapshot.thingId,
          verdict: outcome.verdict.verdict,
          matchedClauseName: outcome.verdict.matchedClauseName,
          factBagSnapshot: outcome.verdict.explanation.factSnapshot,
          explanationTrace: outcome.verdict.explanation.fullTrace,
        },
      };
      await root.events.append(event);
      await root.eventDispatcher.dispatch(event);
      return;
    }

    // live path — guard the breaker, check undo learning, then act
    try {
      await root.circuitBreaker.guard({
        subreddit,
        ruleId: outcome.verdict.ruleId,
        ruleCeiling: root.settings.perRuleActionCeiling,
        subCeiling: root.settings.subwideActionCeiling,
        now,
      });
    } catch (err) {
      if (err instanceof CircuitBreakerOpen) return; // already audited; quietly skip
      throw err;
    }

    const matchedClause = latestClauses(
      active.rules.find((r) => r.id === outcome.verdict!.ruleId)!,
    ).find((c) => c.clauseName === outcome.verdict!.matchedClauseName);

    // Determine the effective verdict — may be deflected to sendToModQueue
    let effectiveVerdict = outcome.verdict;
    if (matchedClause) {
      const fp = fingerprintFromEvaluation({
        subreddit,
        ruleId: outcome.verdict.ruleId,
        clauseName: outcome.verdict.matchedClauseName,
        when: matchedClause.when,
        bag,
      });
      const deflect = await root.undoLearning.shouldDeflect(subreddit, fp);
      if (deflect.deflect) {
        effectiveVerdict = {
          ...outcome.verdict,
          verdict: { kind: 'sendToModQueue' },
          explanation: {
            ...outcome.verdict.explanation,
            shortLine: `${outcome.verdict.explanation.shortLine} — deflected (pattern reversed ${deflect.count}x)`,
          },
        };
      }
    }

    const eventId = brandULID(mintUlid(() => now));
    const token = await root.rollback.mint({
      ruleId: effectiveVerdict.ruleId,
      thingId: snapshot.thingId,
      verdict: effectiveVerdict.verdict,
      originalEventId: eventId,
      windowDays: root.settings.rollbackWindowDays,
    });

    await root.devvitAdapter.executeAction(subreddit, snapshot.thingId, effectiveVerdict.verdict);

    const event: DomainEvent = {
      eventId,
      subreddit,
      occurredAt: now,
      actor: 'system',
      payload: {
        kind: 'ActionTaken',
        ruleId: effectiveVerdict.ruleId,
        version: brandRuleVersion(1),
        thingId: snapshot.thingId,
        verdict: effectiveVerdict.verdict,
        matchedClauseName: effectiveVerdict.matchedClauseName,
        factBagSnapshot: effectiveVerdict.explanation.factSnapshot,
        rollbackTokenId: token?.tokenId ?? eventId,
        rollbackExpiresAt: token?.expiresAt ?? brandTimestampMs(now),
      },
    };
    await root.events.append(event);
    await root.eventDispatcher.dispatch(event);
  };

  app.post('/post-submitted', async (c) => {
    const subreddit = getCurrentSubredditName();
    const raw = (await c.req.json()) as DevvitPostPayload;
    console.log(
      `[edict] post-submitted received: postId=${raw.post?.id ?? '<none>'} title=${raw.post?.title?.slice(0, 60) ?? '<none>'}`,
    );
    const snapshot = await buildPostSnapshot(raw);
    if (!snapshot) {
      console.warn('[edict] post-submitted: payload missing post.id or title, skipping');
      return c.json({ ok: true });
    }
    await handleSubmission(subreddit, snapshot);
    return c.json({ ok: true });
  });

  app.post('/comment-submitted', async (c) => {
    const subreddit = getCurrentSubredditName();
    const raw = (await c.req.json()) as DevvitPostPayload;
    const snapshot = await buildCommentSnapshot(raw);
    if (!snapshot) return c.json({ ok: true });
    await handleSubmission(subreddit, snapshot);
    return c.json({ ok: true });
  });

  app.post('/post-reported', async (c) => {
    const subreddit = getCurrentSubredditName();
    const raw = (await c.req.json()) as DevvitPostPayload;
    const snapshot = await buildPostSnapshot(raw);
    if (!snapshot) return c.json({ ok: true });
    await handleSubmission(subreddit, snapshot);
    return c.json({ ok: true });
  });

  app.post('/comment-reported', async (c) => {
    const subreddit = getCurrentSubredditName();
    const raw = (await c.req.json()) as DevvitPostPayload;
    const snapshot = await buildCommentSnapshot(raw);
    if (!snapshot) return c.json({ ok: true });
    await handleSubmission(subreddit, snapshot);
    return c.json({ ok: true });
  });

  app.post('/flair-changed', (c) => {
    // we use flair changes only to refresh derived facts; no action taken here
    return c.json({ ok: true });
  });

  app.post('/app-installed', async (c) => {
    const subreddit = getCurrentSubredditName();
    await root.devvitAdapter.seedOnInstall(brandSubredditId(subreddit));
    return c.json({ ok: true });
  });

  app.post('/app-upgraded', (c) => {
    // future: run migrations
    return c.json({ ok: true });
  });

  return app;
};
