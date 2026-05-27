import { reddit, redis as devvitRedis } from '@devvit/web/server';

import type { DevvitAdapter } from '@infrastructure/devvit/DevvitAdapter';
import type { TemplateGallery } from '@infrastructure/devvit/TemplateGallery';
import type { EventStore } from '@infrastructure/eventstore/EventStore';
import type { WhatIfReport } from '@analytics/WhatIfStudio';
import type { DecisionExplanation } from '@evaluation/explain/ExplanationTrace';
import type { RuleId, SubredditId } from '@shared/types/BrandedPrimitives';
import { brandSubredditId, brandTimestampMs } from '@shared/types/BrandedPrimitives';
import { isEventKind } from '@domain/events/DomainEvent';
import { InfrastructureFailure } from '@shared/errors/DomainError';

/**
 * Production implementation of the DevvitAdapter port. This is where EDICT
 * actually talks to Reddit: every moderator-visible action (remove / lock /
 * report / ban / flair / modmail / …) goes through `executeAction`, and
 * every custom-post entry-point goes through one of the `ensure…PostUrl`
 * methods.
 *
 * Three pieces of state get persisted in Devvit's Redis (which is
 * automatically namespaced per-installation):
 *
 *   1. `edict:post:command-center`, `edict:post:gallery`, `edict:post:briefing`
 *      — the canonical URL of each custom post for this subreddit. We
 *      submit the post once on first access and cache the URL forever.
 *   2. `edict:whatif:{ruleId}` — cached What-If reports (24 h TTL) so the
 *      Command Center can show the last run without re-replaying 30 days
 *      of events on every navigation.
 *   3. `edict:gallery:catalog` — the curated template list, written on
 *      install so the Gallery custom post can render without re-bundling
 *      the seed file inside the client.
 */

interface ProductionAdapterDeps {
  readonly events: EventStore;
  readonly templates: TemplateGallery;
}

const POST_URL_KEY = {
  commandCenter: 'edict:post:command-center',
  gallery: 'edict:post:gallery',
  briefing: 'edict:post:briefing',
} as const;

const WHATIF_TTL_SECONDS = 24 * 60 * 60;
const GALLERY_CATALOG_KEY = 'edict:gallery:catalog';
const INSTALL_MARKER_KEY = 'edict:install:marker';
const EXPLANATION_LOOKBACK_DAYS = 30;

const isPostId = (thingId: string): boolean => thingId.startsWith('t3_');
const isCommentId = (thingId: string): boolean => thingId.startsWith('t1_');

const muteDurationLabel = (minutes: 60 | 4320 | 10080): '1 hour' | '3 days' | '7 days' => {
  switch (minutes) {
    case 60:
      return '1 hour';
    case 4320:
      return '3 days';
    case 10080:
      return '7 days';
  }
};

const banDurationDays = (duration: 1 | 3 | 7 | 30 | 'permanent'): number | undefined =>
  duration === 'permanent' ? undefined : duration;

export const buildDevvitProductionAdapter = (deps: ProductionAdapterDeps): DevvitAdapter => {
  const ensurePostUrl = async (
    cacheKey: string,
    subreddit: string,
    spec: { title: string; preview: string; entry: string },
  ): Promise<string> => {
    const cached = await devvitRedis.get(cacheKey);
    if (cached) return cached;

    const post = await reddit.submitCustomPost({
      subredditName: subreddit,
      title: spec.title,
      textFallback: { text: spec.preview },
      entry: spec.entry,
    });
    const url = post.url ?? `https://www.reddit.com/r/${subreddit}/comments/${post.id}`;
    await devvitRedis.set(cacheKey, url);
    return url;
  };

  const executeAction: DevvitAdapter['executeAction'] = async (subreddit, thingId, verdict) => {
    const thingIdStr = String(thingId);
    const post = isPostId(thingIdStr)
      ? await reddit.getPostById(thingIdStr as `t3_${string}`)
      : null;
    const comment =
      !post && isCommentId(thingIdStr)
        ? await reddit.getCommentById(thingIdStr as `t1_${string}`)
        : null;
    const target = post ?? comment;
    if (!target) {
      throw new InfrastructureFailure(
        `executeAction: unknown thingId prefix ${thingIdStr} (expected t1_/t3_)`,
      );
    }
    const authorName = (target as { authorName?: string }).authorName ?? '';

    switch (verdict.kind) {
      case 'report': {
        await reddit.report(target, { reason: `EDICT: ${verdict.reasonCode}` });
        return;
      }
      case 'sendToModQueue': {
        await reddit.report(target, { reason: 'EDICT: route to mod queue' });
        return;
      }
      case 'flair': {
        if (!post) return;
        await reddit.setPostFlair({
          subredditName: subreddit as unknown as string,
          postId: thingIdStr as `t3_${string}`,
          flairTemplateId: verdict.flairTemplate,
        });
        return;
      }
      case 'lock': {
        await target.lock();
        return;
      }
      case 'remove': {
        await target.remove(verdict.spam);
        return;
      }
      case 'approve': {
        await target.approve();
        return;
      }
      case 'sticky': {
        if (!post) return;
        await post.sticky(verdict.pinSlot);
        return;
      }
      case 'distinguish': {
        if (verdict.how === 'admin') {
          await (target as { distinguishAsAdmin: () => Promise<void> }).distinguishAsAdmin();
        } else {
          await target.distinguish();
        }
        return;
      }
      case 'mute': {
        if (!authorName) return;
        await reddit.muteUser({
          username: authorName,
          subredditName: subreddit as unknown as string,
          note: `EDICT mute (${muteDurationLabel(verdict.durationMinutes)})`,
        });
        return;
      }
      case 'ban': {
        if (!authorName) return;
        const duration = banDurationDays(verdict.durationDays);
        await reddit.banUser({
          username: authorName,
          subredditName: subreddit as unknown as string,
          reason: verdict.reasonNote.slice(0, 100),
          ...(duration !== undefined ? { duration } : {}),
        });
        return;
      }
      case 'contributorAdd': {
        if (!authorName) return;
        await reddit.approveUser(authorName, subreddit as unknown as string);
        return;
      }
      case 'contributorRemove': {
        if (!authorName) return;
        await reddit.removeUser(authorName, subreddit as unknown as string);
        return;
      }
      case 'commentReply': {
        const replyTarget = (post?.id ?? comment?.id ?? thingIdStr) as
          | `t3_${string}`
          | `t1_${string}`;
        await reddit.submitComment({
          id: replyTarget,
          text: `EDICT: see rule template ${verdict.templateId}.`,
        });
        return;
      }
      case 'modmailNotify': {
        // `createModNotification` requires the subreddit ID (t5_…), not the
        // name we receive in the adapter signature. Look it up once per call;
        // the Devvit client caches per request.
        const sub = await reddit.getSubredditByName(subreddit as unknown as string);
        await reddit.modMail.createModNotification({
          subredditId: sub.id,
          subject: verdict.subjectTemplate.slice(0, 100),
          bodyMarkdown: `An EDICT rule fired on ${thingIdStr}. See the Command Center for details.`,
        });
        return;
      }
    }
  };

  return {
    executeAction,

    ensureCommandCenterPostUrl: (subreddit) =>
      ensurePostUrl(POST_URL_KEY.commandCenter, subreddit, {
        title: 'EDICT · Command Center',
        preview:
          'Active rules, audit timeline, effectiveness, what-if simulator. Open in the Reddit app or new web.',
        entry: 'default',
      }),

    ensureGalleryPostUrl: (subreddit) =>
      ensurePostUrl(POST_URL_KEY.gallery, subreddit, {
        title: 'EDICT · Template Gallery',
        preview: 'Curated, opt-in starter rules across safety, quality, spam, and civility.',
        entry: 'default',
      }),

    ensureBriefingPostUrl: (subreddit) =>
      ensurePostUrl(POST_URL_KEY.briefing, subreddit, {
        title: 'EDICT · Mod Handoff Briefing',
        preview: 'Hourly summary of rule activity since your last visit.',
        entry: 'default',
      }),

    findExplanationForThing: async (subreddit, thingId) => {
      const now = Date.now();
      const events = await deps.events.readWindow({
        subreddit: brandSubredditId(subreddit),
        fromInclusive: brandTimestampMs(now - EXPLANATION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000),
        toExclusive: brandTimestampMs(now + 1),
      });
      // Newest first — most recent decision on this thing wins.
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const event = events[i];
        if (!event) continue;
        if (isEventKind(event, 'ActionTaken') || isEventKind(event, 'ShadowDecisionRecorded')) {
          if (String(event.payload.thingId) !== String(thingId)) continue;
          const isShadow = isEventKind(event, 'ShadowDecisionRecorded');
          const explanation: DecisionExplanation = {
            matched: true,
            shortLine: isShadow
              ? `EDICT shadow decision: would ${event.payload.verdict.kind} via "${event.payload.matchedClauseName}"`
              : `EDICT acted: ${event.payload.verdict.kind} via "${event.payload.matchedClauseName}"`,
            fullTrace: isShadow
              ? event.payload.explanationTrace
              : [
                  `clause: ${event.payload.matchedClauseName}`,
                  `verdict: ${event.payload.verdict.kind}`,
                ],
            factSnapshot: event.payload.factBagSnapshot,
          };
          return explanation;
        }
      }
      return null;
    },

    cacheWhatIfReport: async (subreddit, ruleId, report) => {
      const key = whatIfKey(subreddit, ruleId);
      await devvitRedis.set(key, JSON.stringify(report), {
        expiration: new Date(Date.now() + WHATIF_TTL_SECONDS * 1000),
      });
    },

    readCachedWhatIfReport: async (subreddit, ruleId) => {
      const json = await devvitRedis.get(whatIfKey(subreddit, ruleId));
      if (!json) return null;
      try {
        return JSON.parse(json) as WhatIfReport;
      } catch {
        return null;
      }
    },

    seedOnInstall: async (subreddit) => {
      // Idempotent: skip if we've already seeded this installation.
      const alreadySeeded = await devvitRedis.get(INSTALL_MARKER_KEY);
      if (alreadySeeded) return;

      // Persist the gallery catalog so the Gallery custom post can render
      // without re-bundling the seed file inside the client JS.
      const catalog: Record<string, string> = {};
      for (const template of deps.templates.list()) {
        catalog[template.slug] = JSON.stringify(template);
      }
      if (Object.keys(catalog).length > 0) {
        await devvitRedis.hSet(GALLERY_CATALOG_KEY, catalog);
      }

      await devvitRedis.set(INSTALL_MARKER_KEY, String(Date.now()));
    },
  };
};

const whatIfKey = (subreddit: SubredditId, ruleId: RuleId): string =>
  `edict:whatif:${String(subreddit)}:${String(ruleId)}`;
