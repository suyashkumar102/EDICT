import type { FactBag } from '@evaluation/factbag/FactBag';
import { buildEmptyFactBag, withFact } from '@evaluation/factbag/FactBag';
import type { ConditionAtomKind } from '@domain/values/RuleClause';
import type { ThingId } from '@shared/types/BrandedPrimitives';

/**
 * The structured payload that triggers (onPostSubmit / onCommentSubmit /
 * onPostReport / onCommentReport) deliver to us, normalised. We avoid
 * importing the Devvit types directly here so the evaluator stays pure.
 */
export interface RedditSnapshot {
  readonly kind: 'post' | 'comment';
  readonly thingId: ThingId;
  readonly capturedAt: number;
  readonly title: string;
  readonly body: string;
  readonly authorKarma: number;
  readonly accountCreatedAtMs: number;
  readonly authorVerifiedEmail: boolean;
  readonly authorFlair?: string;
  readonly authorHasModMail: boolean;
  readonly authorBannedInOtherSubInLastDays: number;
  readonly hasLink: boolean;
  readonly linkDomains: readonly string[];
  readonly reportCount: number;
  readonly uniqueReporterCount: number;
  readonly isSelfPost: boolean;
  readonly isCrosspost: boolean;
  readonly postedAtMs: number;
  /** Computed for derived facts; null if not yet measured. */
  readonly postScoreAfterMinutes?: number;
  readonly replyCountAfterMinutes?: number;
}

const TITLE_ALL_CAPS_THRESHOLD = 0.7;

const isLikelyAllCaps = (title: string): boolean => {
  const letters = title.replace(/[^A-Za-z]/g, '');
  if (letters.length < 4) return false;
  const upper = letters.replace(/[^A-Z]/g, '');
  return upper.length / letters.length >= TITLE_ALL_CAPS_THRESHOLD;
};

const containsQuestionMark = (title: string): boolean => title.includes('?');

const daysBetween = (laterMs: number, earlierMs: number): number =>
  Math.max(0, Math.floor((laterMs - earlierMs) / (24 * 60 * 60 * 1000)));

const minutesBetween = (laterMs: number, earlierMs: number): number =>
  Math.max(0, Math.floor((laterMs - earlierMs) / (60 * 1000)));

const hourOfDayUtc = (ms: number): number => new Date(ms).getUTCHours();

/**
 * Build a complete FactBag from a Reddit snapshot. The set of slots filled
 * is the *intersection* of "facts referenced by the active rule set" and
 * "facts available from this snapshot kind". The evaluator handles missing
 * slots gracefully.
 */
export const buildFactBag = (
  snapshot: RedditSnapshot,
  factsNeeded: ReadonlySet<ConditionAtomKind>,
): FactBag => {
  let bag = buildEmptyFactBag(snapshot.thingId, snapshot.capturedAt);

  const want = (fact: ConditionAtomKind): boolean => factsNeeded.has(fact);

  if (want('postLengthChars') && snapshot.kind === 'post') {
    bag = withFact(bag, 'postLengthChars', snapshot.body.length);
  }
  if (want('commentLengthChars') && snapshot.kind === 'comment') {
    bag = withFact(bag, 'commentLengthChars', snapshot.body.length);
  }
  if (want('accountAgeDays')) {
    bag = withFact(
      bag,
      'accountAgeDays',
      daysBetween(snapshot.capturedAt, snapshot.accountCreatedAtMs),
    );
  }
  if (want('authorKarma')) {
    bag = withFact(bag, 'authorKarma', snapshot.authorKarma);
  }
  if (want('authorVerifiedEmail')) {
    bag = withFact(bag, 'authorVerifiedEmail', snapshot.authorVerifiedEmail);
  }
  if (want('titleMatchesPattern') && snapshot.kind === 'post') {
    bag = withFact(bag, 'titleMatchesPattern', snapshot.title);
  }
  if (want('bodyMatchesPattern')) {
    bag = withFact(bag, 'bodyMatchesPattern', snapshot.body);
  }
  if (want('titleAllCaps') && snapshot.kind === 'post') {
    bag = withFact(bag, 'titleAllCaps', isLikelyAllCaps(snapshot.title));
  }
  if (want('titleQuestionMark') && snapshot.kind === 'post') {
    bag = withFact(bag, 'titleQuestionMark', containsQuestionMark(snapshot.title));
  }
  if (want('hasLink')) {
    bag = withFact(bag, 'hasLink', snapshot.hasLink);
  }
  if (want('domainEqualsAnyOf') && snapshot.linkDomains.length > 0) {
    bag = withFact(bag, 'domainEqualsAnyOf', snapshot.linkDomains);
  }
  if (want('subredditAgeMinutes')) {
    bag = withFact(
      bag,
      'subredditAgeMinutes',
      minutesBetween(snapshot.capturedAt, snapshot.postedAtMs),
    );
  }
  if (want('reportCount')) {
    bag = withFact(bag, 'reportCount', snapshot.reportCount);
  }
  if (want('uniqueReporterCount')) {
    bag = withFact(bag, 'uniqueReporterCount', snapshot.uniqueReporterCount);
  }
  if (want('flairEqualsAnyOf') && snapshot.authorFlair) {
    bag = withFact(bag, 'flairEqualsAnyOf', snapshot.authorFlair);
  }
  if (want('isSelfPost') && snapshot.kind === 'post') {
    bag = withFact(bag, 'isSelfPost', snapshot.isSelfPost);
  }
  if (want('isCrosspost') && snapshot.kind === 'post') {
    bag = withFact(bag, 'isCrosspost', snapshot.isCrosspost);
  }
  if (want('postScoreAfterMinutes') && snapshot.postScoreAfterMinutes !== undefined) {
    bag = withFact(bag, 'postScoreAfterMinutes', snapshot.postScoreAfterMinutes);
  }
  if (want('replyCountAfterMinutes') && snapshot.replyCountAfterMinutes !== undefined) {
    bag = withFact(bag, 'replyCountAfterMinutes', snapshot.replyCountAfterMinutes);
  }
  if (want('authorBannedInOtherSubInLastDays')) {
    bag = withFact(
      bag,
      'authorBannedInOtherSubInLastDays',
      snapshot.authorBannedInOtherSubInLastDays,
    );
  }
  if (want('authorHasModMail')) {
    bag = withFact(bag, 'authorHasModMail', snapshot.authorHasModMail);
  }
  if (want('timeOfDayHourUtc')) {
    bag = withFact(bag, 'timeOfDayHourUtc', hourOfDayUtc(snapshot.capturedAt));
  }
  return bag;
};

/**
 * Walk every rule and accumulate the set of facts the evaluator will actually
 * read. The FactBagBuilder only populates slots in this set — meaning a rule
 * that never references `authorKarma` doesn't pay the (Reddit API) cost of
 * fetching it.
 */
export const factsReferencedBy = (
  rules: readonly {
    readonly clauses: readonly { readonly when: unknown; readonly unless?: unknown }[];
  }[],
): ReadonlySet<ConditionAtomKind> => {
  const acc = new Set<ConditionAtomKind>();
  const walk = (tree: unknown): void => {
    if (typeof tree !== 'object' || tree === null) return;
    const node = tree as {
      kind: string;
      fact?: ConditionAtomKind;
      children?: unknown[];
      child?: unknown;
    };
    if (node.kind === 'atom' && node.fact) acc.add(node.fact);
    if (node.kind === 'and' || node.kind === 'or') node.children?.forEach(walk);
    if (node.kind === 'not') walk(node.child);
  };
  for (const r of rules) {
    for (const c of r.clauses) {
      walk(c.when);
      if (c.unless) walk(c.unless);
    }
  }
  return acc;
};
