import { z } from 'zod';
import { MAX_PATTERN_CHARS, validatePattern } from '@evaluation/conditions/SafeRegex';

/**
 * The strict Zod schema for a compiled multi-clause rule.
 *
 * The LLM produces JSON; this schema is the gate that decides whether that
 * JSON ever reaches the event store. A rule that fails parse is a rejected
 * rule, full stop — we never coerce, never "fix it up", never auto-default
 * missing fields. The compile-time round-trip is:
 *
 *     English ──► JSON ──► Schema parse ──► RuleDrafted event
 *
 * If any of these fails, the moderator sees an explainable error and the
 * draft is held; the LLM is *not* re-called automatically.
 *
 * This schema is also exported as a JSON Schema for the OpenAI structured-
 * output `response_format` parameter — meaning the model is hardened against
 * shape drift at the API boundary in addition to here.
 */

// ---------- comparators ----------
// Single flat discriminatedUnion on 'kind' — Zod v4's z.union() "best match"
// mode can silently fail when nesting multiple discriminatedUnions inside it.
// A flat discriminatedUnion is unambiguous and fast.
//
// Note: Gemini sometimes returns numeric values as strings (e.g. "50" instead
// of 50). z.coerce.number() handles both transparently.

const numericValue = z.coerce.number().finite();

const comparator = z.discriminatedUnion('kind', [
  // numeric
  z.object({ kind: z.literal('lt'), value: numericValue }),
  z.object({ kind: z.literal('lte'), value: numericValue }),
  z.object({ kind: z.literal('gt'), value: numericValue }),
  z.object({ kind: z.literal('gte'), value: numericValue }),
  z
    .object({
      kind: z.literal('between'),
      min: numericValue,
      max: numericValue,
    })
    .refine((v) => v.min <= v.max, { message: 'between.min must be <= between.max' }),
  // equality
  z.object({
    kind: z.literal('eq'),
    value: z.union([z.string().max(500), z.number().finite(), z.boolean()]),
  }),
  z.object({
    kind: z.literal('neq'),
    value: z.union([z.string().max(500), z.number().finite(), z.boolean()]),
  }),
  z.object({
    kind: z.literal('in'),
    values: z
      .array(z.union([z.string().max(500), z.number().finite()]))
      .min(1)
      .max(50),
  }),
  // string / regex
  z
    .object({
      kind: z.literal('matches'),
      pattern: z.string().min(1).max(MAX_PATTERN_CHARS),
      caseSensitive: z.boolean(),
    })
    .superRefine((c, ctx) => {
      const result = validatePattern(c.pattern);
      if (!result.ok) {
        ctx.addIssue(`regex pattern rejected at compile time: ${result.reason ?? 'invalid'}`);
      }
    }),
  // boolean
  z.object({ kind: z.literal('isTrue') }),
  z.object({ kind: z.literal('isFalse') }),
]);

// ---------- condition atoms ----------

const conditionAtomKind = z.enum([
  'postLengthChars',
  'commentLengthChars',
  'accountAgeDays',
  'authorKarma',
  'authorVerifiedEmail',
  'titleMatchesPattern',
  'bodyMatchesPattern',
  'titleAllCaps',
  'titleQuestionMark',
  'hasLink',
  'domainEqualsAnyOf',
  'subredditAgeMinutes',
  'reportCount',
  'uniqueReporterCount',
  'flairEqualsAnyOf',
  'isSelfPost',
  'isCrosspost',
  'postScoreAfterMinutes',
  'replyCountAfterMinutes',
  'authorBannedInOtherSubInLastDays',
  'authorHasModMail',
  'timeOfDayHourUtc',
]);

const conditionAtom = z.object({
  kind: z.literal('atom'),
  fact: conditionAtomKind,
  comparator,
  atomId: z.string().regex(/^[A-Z0-9]{6,16}$/),
});

// ---------- recursive condition tree ----------

export const conditionTreeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    conditionAtom,
    z.object({
      kind: z.literal('and'),
      children: z.array(conditionTreeSchema).min(2).max(10),
    }),
    z.object({
      kind: z.literal('or'),
      children: z.array(conditionTreeSchema).min(2).max(10),
    }),
    z.object({
      kind: z.literal('not'),
      child: conditionTreeSchema,
    }),
  ]),
);

// ---------- action verdicts ----------

const reasonCode = z.string().regex(/^[a-z0-9-]{2,40}$/);

const safeActionVerdict = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('report'), reasonCode }),
  z.object({ kind: z.literal('flair'), flairTemplate: z.string().min(1).max(60) }),
  z.object({ kind: z.literal('lock') }),
  z.object({ kind: z.literal('sendToModQueue') }),
  z.object({ kind: z.literal('approve') }),
  z.object({ kind: z.literal('sticky'), pinSlot: z.union([z.literal(1), z.literal(2)]) }),
  z.object({ kind: z.literal('distinguish'), how: z.enum(['moderator', 'admin']) }),
  z.object({ kind: z.literal('commentReply'), templateId: z.string().min(1).max(60) }),
  z.object({ kind: z.literal('modmailNotify'), subjectTemplate: z.string().min(1).max(80) }),
]);

const riskyActionVerdict = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('remove'), spam: z.boolean() }),
  z.object({
    kind: z.literal('mute'),
    durationMinutes: z.union([z.literal(60), z.literal(4320), z.literal(10080)]),
  }),
  z.object({
    kind: z.literal('ban'),
    durationDays: z.union([
      z.literal(1),
      z.literal(3),
      z.literal(7),
      z.literal(30),
      z.literal('permanent'),
    ]),
    reasonNote: z.string().min(1).max(200),
  }),
  z.object({ kind: z.literal('contributorAdd') }),
  z.object({ kind: z.literal('contributorRemove') }),
]);

export const actionVerdictSchema = z.union([safeActionVerdict, riskyActionVerdict]);

// ---------- clause ----------

export const ruleClauseSchema = z.object({
  clauseName: z.string().min(3).max(60),
  comment: z.string().max(280).optional(),
  when: conditionTreeSchema,
  unless: conditionTreeSchema.optional(),
  verdict: actionVerdictSchema,
});

// ---------- full compiled rule ----------

export const compiledRuleSchema = z.object({
  schemaVersion: z.literal(1),
  title: z.string().min(3).max(80),
  description: z.string().min(10).max(500),
  englishSource: z.string().min(8).max(2000),
  clauses: z.array(ruleClauseSchema).min(1).max(8),
  /** Compiler self-reported confidence; cross-checked against the heuristics in CompilerService. */
  compilerConfidence: z.number().min(0).max(1),
  /** Optional structured tags for gallery categorization (e.g. ['spam', 'low-karma']). */
  tags: z
    .array(z.string().regex(/^[a-z0-9-]{2,30}$/))
    .max(8)
    .optional(),
});

export type CompiledRule = z.infer<typeof compiledRuleSchema>;
export type RuleClauseShape = z.infer<typeof ruleClauseSchema>;
export type ActionVerdictShape = z.infer<typeof actionVerdictSchema>;

export const isStructurallyValid = (raw: unknown): raw is CompiledRule => {
  return compiledRuleSchema.safeParse(raw).success;
};

/** Convert Zod parse errors into a clean list of human-readable strings. */
export const formatIssues = (parsed: z.ZodSafeParseResult<CompiledRule>): readonly string[] => {
  if (parsed.success) return [];
  return parsed.error.issues.map((iss) => `${iss.path.join('.') || '<root>'} — ${iss.message}`);
};
