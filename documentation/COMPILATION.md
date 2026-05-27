# Compilation — English → JSON

The compilation layer is the only place EDICT calls a language model.
This document covers the prompt design, schema, ambiguity handling, and
output validation.

---

## When the compiler runs

Exactly when a moderator clicks **Compile** in the Rule Composer (or
its equivalents in the menu form). Never on a post submission. Never
on a comment. Never on a scheduled tick.

The moderator's typed English is the only user-supplied data sent to
the model. Reddit content (post bodies, comment bodies, usernames) is
never included in the request body.

---

## The system prompt

`source/compilation/prompts/CompilerSystemPrompt.ts` contains the full
text. Key invariants the prompt enforces:

1. **Output format.** The model must call exactly one of two tools:
   `compileRule` (success) or `clarify` (need more info). Anything else
   — markdown, prose, partial JSON — is rejected by the OpenAI client.

2. **Closed atom vocabulary.** The prompt enumerates every
   `ConditionAtomKind` the evaluator knows about. The model cannot
   invent fact names; if it tries, the schema validation rejects the
   output. Closing the vocabulary at the prompt level is belt + braces.

3. **Risky-verdict guard.** The prompt forbids the model from emitting
   `remove` / `mute` / `ban` / `contributorAdd` / `contributorRemove`
   unless the moderator explicitly named them. The schema validator
   then re-checks against the `optInActions` set.

4. **Clarify decision matrix.** The prompt gives the model a decision
   table for when to call `clarify` vs `compileRule`: ambiguous facts,
   unspecified numeric thresholds, implied risky verbs, structural
   ambiguity.

5. **Confidence rubric.** The model self-reports a `compilerConfidence`
   in `[0, 1]` with a rubric anchoring 0.95+ to "clean parse" and
   below-0.7 to "should have clarified instead." Used downstream by
   the adaptive shadow policy and the Studio.

---

## Few-shot exemplars

`source/compilation/prompts/CompilerExemplars.ts` ships 6 exemplars:

1. **ex01** — single-atom rule (covers easy case)
2. **ex02** — AND of two atoms (covers compound condition)
3. **ex03** — OR of three atoms (covers disjunction)
4. **ex04** — WHEN ... UNLESS (covers exception)
5. **ex05** — multi-clause with tiered escalation
6. **ex06** — ambiguous → calls `clarify`

The exemplar set deliberately excludes risky verbs so the prior is
pulled toward safety.

---

## The Zod schema

`source/compilation/schema/RuleSchema.ts` is the gate. Every compiled
rule round-trips through `compiledRuleSchema.safeParse(raw)`. The
parse is **strict** (`additionalProperties: false` everywhere) — extra
keys, missing keys, type mismatches, all fail.

Top-level shape:

```ts
{
  schemaVersion: 1,
  title: string (3..80),
  description: string (10..500),
  englishSource: string (8..2000),
  compilerConfidence: number (0..1),
  tags?: string[] (max 8, kebab-case),
  clauses: RuleClause[] (1..8),
}
```

Each `RuleClause`:

```ts
{
  clauseName: string (3..60),
  comment?: string (≤280),
  when: ConditionTree,
  unless?: ConditionTree,
  verdict: ActionVerdict,
}
```

`ConditionTree` is recursive — `atom | and | or | not`. The `and`/`or`
nodes require 2..10 children; `not` is unary. `atom` carries the fact
name, a comparator, and a 6–16-char uppercase `atomId`.

`ActionVerdict` is a tagged union of 14 kinds, split into a safe set
(emittable freely) and a risky set (requires explicit opt-in).

---

## JSON Schema mirror

Because OpenAI's structured-output `response_format` takes JSON Schema,
not Zod, we hand-author a JSON Schema mirror in
`source/compilation/schema/JsonSchemaExport.ts`. The two schemas are
kept in lock-step; a round-trip test in
`tests/property/SchemaParity.test.ts` (planned for v1.1) ensures any
rule the JSON-Schema-constrained model emits also parses through the
Zod schema.

Why the duplication: OpenAI's JSON Schema dialect rejects some
Zod-emitted constructs (nested discriminators with refinement
metadata). Hand-authoring lets us produce the exact shape OpenAI
accepts.

---

## Validation pipeline

```
LLM JSON
   │
   ▼
JSON.parse                       ← throws CompilationFailure
   │
   ▼
compiledRuleSchema.safeParse     ← throws SchemaValidationFailure
   │
   ▼
ActionWhitelistPolicy.decide     ← throws SchemaValidationFailure
   │ (per clause verdict)
   ▼
atom-id uniqueness sweep         ← throws SchemaValidationFailure
   │
   ▼
fingerprint + diffSummary        ← returns CompileResult
```

Every failure produces a `DomainError` subclass with a machine-readable
`kind` and a human-readable message. Routes branch on `instanceof`
to decide HTTP status and toast appearance.

---

## Ambiguity flow

`AmbiguityResolver` wraps `CompilerService.compile` with a 3-round
clarification loop:

```
attempt → compile → success?
   no, AmbiguousSentenceError
   ▼
   if rounds === 3 → timed-out
   else → return clarify outstanding
              { question, options, continueWith }
   the UI surfaces options, user picks, calls continueWith(answer)
   which recurses with priorClarifications appended
```

The English passed to the LLM grows with each round:

```
<original sentence>

— clarifications captured —
(clarification 1) Q: How would you like EDICT to define "low-effort"?
A: Post under 50 chars AND account younger than 24 hours

(clarification 2) ...
```

This keeps the model coherent without us managing conversation state.

---

## Determinism

Compiler calls are deterministic by design:

- `temperature = 0`
- `tool_choice = 'required'`
- Same input → same output

Two consequences:

- A repeat compile of the same English is idempotent. The result
  fingerprint (in `CompileResult.fingerprint`) is stable.
- The conflict detector and Studio can cache by fingerprint.

The fingerprint strips `atomId`s and `clauseName`s (decorative metadata)
so two rules that are _structurally_ identical fingerprint the same.

---

## Quotas and cost

EDICT enforces a per-sub daily compile quota (see the
`compileQuotaKey` namespace in `infrastructure/redis/KeyNamespacing.ts`).
Cost ceiling per sub per day: 50 compiles by default — well above
typical use, well below abuse.

Real-world cost: one compile uses ~2K input + ~400 output tokens. At
gpt-5.4-mini rates that's fractions of a cent.
