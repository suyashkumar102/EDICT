import type { RuleTemplate } from '@infrastructure/devvit/TemplateGallery';

/**
 * Curated seed templates. Hand-crafted, not generated. Each template is
 * a starting point a mod can import and edit — never auto-activated.
 *
 * Selection criteria for inclusion in v1.0:
 *   - Solves a real pain point reported in r/ModSupport
 *   - Maps to a single English sentence (compiler-friendly)
 *   - Uses only safe verdicts (no ban/mute/remove)
 *   - Has a clear "shadow first, observe a day" suggested duration
 *
 * Categories sum: safety (5) · quality (6) · spam (6) · civility (3) ·
 * moderation (4) · community (6) = 30 templates.
 */

export const SEED_TEMPLATES: readonly RuleTemplate[] = [
  // -------- SAFETY --------
  {
    slug: 'low-karma-low-tenure',
    category: 'safety',
    title: 'Low karma + low tenure → mod queue',
    summary: 'Send to mod queue if author karma is below 50 and account is under 30 days old.',
    englishSource:
      'Send to mod queue any post or comment whose author has less than 50 karma and an account younger than 30 days.',
    suggestedShadowHours: 48,
  },
  {
    slug: 'unverified-email-link-post',
    category: 'safety',
    title: 'Unverified email + link post → mod queue',
    summary: 'Catches throwaway promo accounts.',
    englishSource:
      'Send to mod queue any post that contains a link if the author has not verified their email.',
    suggestedShadowHours: 24,
  },
  {
    slug: 'banned-elsewhere-recently',
    category: 'safety',
    title: 'Banned elsewhere in last 30d → report',
    summary: 'Flag commenters who were recently banned from another sub.',
    englishSource:
      'Report any comment from an author who was banned in another subreddit in the last 30 days.',
    suggestedShadowHours: 72,
  },
  {
    slug: 'pii-pattern-modqueue',
    category: 'safety',
    title: 'Personal info pattern → mod queue',
    summary: 'Catches likely doxxing attempts (full names + addresses).',
    englishSource:
      'Send to mod queue any comment whose body matches the pattern "[A-Z][a-z]+ [A-Z][a-z]+, \\\\d+ [A-Z][a-z]+ St".',
    suggestedShadowHours: 12,
  },
  {
    slug: 'midnight-throwaway',
    category: 'safety',
    title: 'New account + post between 2-5am UTC → mod queue',
    summary: 'Throwaways and brigade waves cluster in dead hours.',
    englishSource:
      'Send to mod queue any post from an account younger than 24 hours if it was posted between 2 and 5 AM UTC.',
    suggestedShadowHours: 48,
  },

  // -------- QUALITY --------
  {
    slug: 'allcaps-title-lock',
    category: 'quality',
    title: 'All-caps title → lock',
    summary: 'Discourages shouting.',
    englishSource: 'Lock any post whose title is in all caps.',
    suggestedShadowHours: 12,
  },
  {
    slug: 'short-post-modqueue',
    category: 'quality',
    title: 'Very short post → mod queue',
    summary: 'Sub-50-char posts are usually low-effort.',
    englishSource: 'Send to mod queue any post under 50 characters.',
    suggestedShadowHours: 24,
  },
  {
    slug: 'short-comment-on-old-thread',
    category: 'quality',
    title: 'Short comment on old thread → modqueue',
    summary: 'Catches one-word necroposts.',
    englishSource:
      'Send to mod queue any comment under 25 characters where the original post is older than 90 days.',
    suggestedShadowHours: 24,
  },
  {
    slug: 'question-title-no-body',
    category: 'quality',
    title: 'Question title + empty body → flair',
    summary: 'Flair these so power-users can filter.',
    englishSource:
      'Flair as "needs-more-context" any post with a question mark in its title and a body under 10 characters.',
    suggestedShadowHours: 12,
  },
  {
    slug: 'crosspost-from-banned-sub',
    category: 'quality',
    title: 'Crosspost from blocklisted subs → mod queue',
    summary: 'Edit the domain list to fit your community.',
    englishSource:
      'Send to mod queue any crosspost whose origin subreddit equals one of: r/banned-sub-a, r/banned-sub-b.',
    suggestedShadowHours: 24,
  },
  {
    slug: 'low-effort-title-pattern',
    category: 'quality',
    title: 'Title matches "this is awesome", "lol", etc → flair',
    summary: 'Generic title patterns.',
    englishSource:
      'Flair as "low-effort-title" any post whose title matches the pattern "^(lol|wow|nice|awesome|cool)\\\\.?$".',
    suggestedShadowHours: 24,
  },
  {
    slug: 'sticky-comment-on-megathread',
    category: 'quality',
    title: 'Sticky a comment on the daily megathread',
    summary: 'Pin a top-of-thread comment template.',
    englishSource:
      'On any post whose flair is "megathread", reply with template "megathread-pinned-comment" and sticky it.',
    suggestedShadowHours: 12,
  },

  // -------- SPAM --------
  {
    slug: 'url-shortener-report',
    category: 'spam',
    title: 'URL-shortener domain → report',
    summary: 'bit.ly, tinyurl.com, t.co, ow.ly, etc.',
    englishSource:
      'Report any post or comment containing a link where the domain is one of: bit.ly, tinyurl.com, t.co, ow.ly, is.gd, buff.ly.',
    suggestedShadowHours: 24,
  },
  {
    slug: 'newuser-with-link',
    category: 'spam',
    title: 'New user + link → mod queue',
    summary: 'Common promo-account pattern.',
    englishSource:
      'Send to mod queue any post containing a link if the author account is younger than 14 days.',
    suggestedShadowHours: 48,
  },
  {
    slug: 'repeat-poster-throttle',
    category: 'spam',
    title: 'Five posts in 24h → flair',
    summary: 'Flair high-volume posters so mods see the burst.',
    englishSource:
      'Flair as "high-volume-poster" any post if the author has posted 5 or more times in this subreddit in the last 24 hours.',
    suggestedShadowHours: 24,
  },
  {
    slug: 'crypto-promo',
    category: 'spam',
    title: 'Common crypto-shill patterns → report',
    summary: 'Edit the keyword list to fit your domain.',
    englishSource:
      'Report any post whose body matches the pattern "(?i)\\\\b(presale|airdrop|x100|moonshot|gem)\\\\b".',
    suggestedShadowHours: 48,
  },
  {
    slug: 'image-only-no-context',
    category: 'spam',
    title: 'Image-only post + empty selftext → mod queue',
    summary: 'Catch image-only spam with no description.',
    englishSource:
      'Send to mod queue any post that is not a self-post and whose body is under 5 characters.',
    suggestedShadowHours: 24,
  },
  {
    slug: 'astroturfing-burst',
    category: 'spam',
    title: '3+ unique reporters on a young post → mod queue',
    summary: 'Catches coordinated downvote brigades.',
    englishSource:
      'Send to mod queue any post that has 3 or more unique reporters when the post is younger than 30 minutes.',
    suggestedShadowHours: 24,
  },

  // -------- CIVILITY --------
  {
    slug: 'caps-comment-flair',
    category: 'civility',
    title: 'All-caps comment in heated thread → mod queue',
    summary: 'Heuristic tone check.',
    englishSource:
      'Send to mod queue any comment whose body matches the pattern "^[A-Z !?]{30,}$".',
    suggestedShadowHours: 24,
  },
  {
    slug: 'profanity-spike-in-young-comment',
    category: 'civility',
    title: 'Profanity in first comment from new account → flair',
    summary: 'Edit the profanity list to your community.',
    englishSource:
      'Flair as "first-comment-spicy" any comment whose body matches the pattern "(?i)\\\\b(asshole|moron|idiot)\\\\b" if the account is younger than 7 days.',
    suggestedShadowHours: 48,
  },
  {
    slug: 'all-caps-reply-after-warning',
    category: 'civility',
    title: 'All-caps reply on a thread already locked',
    summary: 'Mod-queue posts that ignore prior lock signals.',
    englishSource:
      'Send to mod queue any comment whose body matches "^[A-Z ]{20,}$" if the parent post is locked.',
    suggestedShadowHours: 24,
  },

  // -------- MODERATION --------
  {
    slug: 'reported-thrice-by-distinct-users',
    category: 'moderation',
    title: '3+ unique reporters → mod queue (universal)',
    summary: 'Bread-and-butter; no tenure exception.',
    englishSource: 'Send to mod queue any post or comment that has 3 or more unique reporters.',
    suggestedShadowHours: 12,
  },
  {
    slug: 'reported-by-trusted-mods-list',
    category: 'moderation',
    title: 'Reported by a moderator → fast-track removal',
    summary: 'Skip mod queue when a mod reports it themselves.',
    englishSource:
      'Send to mod queue immediately any post that has been reported by an author flaired "moderator".',
    suggestedShadowHours: 12,
  },
  {
    slug: 'flair-changed-after-removal',
    category: 'moderation',
    title: 'Flair changed back after removal → re-report',
    summary: 'Catches users who try to undo flair-based actions.',
    englishSource:
      'Report any post if its current flair is "removed-by-mod" and was just changed back.',
    suggestedShadowHours: 24,
  },
  {
    slug: 'mod-mail-trigger',
    category: 'moderation',
    title: 'Bounced-back DM template → notify modmail',
    summary: 'Surface returned modmail patterns to the team.',
    englishSource:
      'Send a modmail with subject "edict-flag-bouncer" if a comment body matches the pattern "(?i)(this is an automated|delivery failed)".',
    suggestedShadowHours: 24,
  },

  // -------- COMMUNITY --------
  {
    slug: 'welcome-first-post',
    category: 'community',
    title: "Welcome reply on a user's first post",
    summary: 'Reply with the welcome template + sticky on slot 1.',
    englishSource:
      'On a user\'s first post in this subreddit, reply with template "welcome-first-post" and sticky it.',
    suggestedShadowHours: 12,
  },
  {
    slug: 'highlight-trusted-contributor',
    category: 'community',
    title: 'Distinguish posts from contributors',
    summary: 'Visual signal for power-users.',
    englishSource:
      'On any post by a user whose karma in this subreddit exceeds 5000, distinguish the post as moderator.',
    suggestedShadowHours: 12,
  },
  {
    slug: 'weekly-thread-routing',
    category: 'community',
    title: 'Off-topic-during-megathread → mod queue',
    summary: 'Route off-topic posts during the megathread window.',
    englishSource:
      'Send to mod queue any post whose title does not contain "megathread" if posted between Sunday 0:00 and Monday 0:00 UTC.',
    suggestedShadowHours: 48,
  },
  {
    slug: 'high-karma-trust-grace',
    category: 'community',
    title: 'High-karma authors get a trust grace period',
    summary: 'Skip the standard route for established accounts.',
    englishSource: 'Approve any post under 50 characters if the author karma is above 5000.',
    suggestedShadowHours: 24,
  },
  {
    slug: 'positive-engagement-boost',
    category: 'community',
    title: 'Sticky high-engagement posts on slot 2',
    summary: 'Pin posts that gain >50 karma in 10 minutes.',
    englishSource: 'Sticky on slot 2 any post that gains a score above 50 in the first 10 minutes.',
    suggestedShadowHours: 24,
  },
  {
    slug: 'modmail-on-anniversary',
    category: 'community',
    title: 'Anniversary thank-you modmail',
    summary: 'Auto-modmail thank-you to long-time contributors.',
    englishSource:
      'Send a modmail with subject "edict-anniversary" if an author posts and their karma in this subreddit exceeds 10000.',
    suggestedShadowHours: 12,
  },
] as const;
