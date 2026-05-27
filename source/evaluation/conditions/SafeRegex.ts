/**
 * Defensive regex evaluation for the `matches` comparator.
 *
 * The compiler may emit arbitrary regex strings produced by the LLM, and
 * the evaluator runs on every post/comment in the subreddit. A pathological
 * pattern like `(a+)+$` evaluated against a long string blocks the event
 * loop for seconds — well past the Devvit serverless handler budget — and
 * would let a rule author (or a model hallucination) DoS the whole sub.
 *
 * We close that hole with four layers of defence:
 *
 *   1. **Pattern-length cap.** Patterns longer than `MAX_PATTERN_CHARS`
 *      can express arbitrary state machines; we refuse to compile them.
 *      Mods who genuinely need a long pattern can split it across clauses.
 *
 *   2. **Nested-quantifier reject.** The textbook ReDoS shape
 *      `(group with + or *) followed by + or *` is detected by a regex
 *      against the pattern source and rejected at compile time.
 *
 *   3. **Backreference reject.** `\1`-style backreferences turn the
 *      regex engine into a non-deterministic matcher with exponential
 *      worst case. EDICT has no legitimate use for them — every fact
 *      we expose is a scalar, not a tuple — so we ban them outright.
 *
 *   4. **Input-length truncation.** Even a safe pattern can be slow
 *      against a megabyte string. We truncate the haystack to
 *      `MAX_HAYSTACK_CHARS` (4 KB) before matching. Reddit titles cap
 *      at ~300, comment bodies at 10 KB — both fit comfortably below
 *      the cap, and a 4 KB head is more than enough signal for the
 *      kinds of patterns moderation rules actually use.
 *
 * All four guards return `false` (no match) rather than throwing, so
 * a pathological pattern silently fails closed — the rule "doesn't fire"
 * rather than tripping the breaker. The compile-time validator in
 * `RuleSchema.ts` rejects the pattern *before* it can be stored, so this
 * runtime path is belt-and-braces.
 */

export const MAX_PATTERN_CHARS = 200;
export const MAX_HAYSTACK_CHARS = 4096;

// Matches the textbook ReDoS shape: a quantified group immediately
// followed by another quantifier. Example matches: (a+)+, (a*)*, (a{1,3})+
// Example non-matches: (a+), a+b+, [a-z]+
const NESTED_QUANTIFIER = /\([^)]*[+*{][^)]*\)[+*?{]/;

// Matches \1, \2, ..., \9 as backreferences. Does NOT match \\1 (literal
// backslash followed by 1) because the preceding \\ already escapes.
const BACKREFERENCE = /(?<!\\)\\[1-9]/;

export interface SafeRegexCompileResult {
  readonly ok: boolean;
  readonly reason?: 'too-long' | 'nested-quantifier' | 'backreference' | 'invalid';
}

/**
 * Compile-time pattern validation. Returns `{ ok: true }` if the pattern
 * is safe to ship, or `{ ok: false, reason: ... }` so the schema
 * validator can include the reason in its error message.
 */
export const validatePattern = (pattern: string): SafeRegexCompileResult => {
  if (pattern.length === 0) {
    // An empty pattern matches every position; firing a rule on
    // "matches: ''" is never the moderator's intent and is also blocked
    // by the schema's min(1). Treat it as invalid at runtime too.
    return { ok: false, reason: 'invalid' };
  }
  if (pattern.length > MAX_PATTERN_CHARS) {
    return { ok: false, reason: 'too-long' };
  }
  if (NESTED_QUANTIFIER.test(pattern)) {
    return { ok: false, reason: 'nested-quantifier' };
  }
  if (BACKREFERENCE.test(pattern)) {
    return { ok: false, reason: 'backreference' };
  }
  try {
    // eslint-disable-next-line no-new
    new RegExp(pattern);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
};

/**
 * Run-time safe match. Applies all four guards and returns a plain
 * boolean. A failure at any guard returns `false` — i.e., the rule
 * doesn't fire. This is the only entry point the evaluator should use.
 */
export const safeRegexTest = (
  pattern: string,
  haystack: string,
  options: { caseSensitive: boolean },
): boolean => {
  const check = validatePattern(pattern);
  if (!check.ok) return false;

  const trimmed =
    haystack.length > MAX_HAYSTACK_CHARS ? haystack.slice(0, MAX_HAYSTACK_CHARS) : haystack;

  try {
    const flags = options.caseSensitive ? '' : 'i';
    return new RegExp(pattern, flags).test(trimmed);
  } catch {
    return false;
  }
};
