# Evaluation — runtime rule execution

The evaluator runs on every post, comment, and report. It produces a
verdict (or null) for each rule. Zero LLM calls. Zero network. Pure
TypeScript.

---

## The pipeline

```
trigger payload
   │
   ▼
RedditSnapshot       (normalised view of the payload)
   │
   ▼
factsReferencedBy    (which atoms do active rules care about?)
   │
   ▼
buildFactBag         (populate only those slots)
   │
   ▼
evaluateRuleSet      (first rule to fire wins; collect secondaries)
   │
   ▼
RuleVerdict | null
```

Total cost on a typical post: nanoseconds for the evaluator itself plus
one Redis read to fetch active rules. No per-post LLM. No per-post
fetch beyond what Reddit already gives us in the trigger payload.

---

## FactBag

A `FactBag` is an immutable, scoped snapshot of every fact a rule could
need. It has two layers:

1. **The slots** — sparse `Partial<Record<ConditionAtomKind, FactValue>>`
   filled by `buildFactBag`. Each slot corresponds to one
   `ConditionAtomKind`.
2. **The flattening** — `flatten(bag)` projects the slots to a
   string-keyed, scalar-only record suitable for event-store storage.
   Arrays become comma-joined; nested values become JSON strings.

Why "what facts does the active rule set need":

```ts
const factsNeeded = factsReferencedBy(active.rules);
const bag = buildFactBag(snapshot, factsNeeded);
```

A rule that never mentions `authorKarma` doesn't pay the cost of
computing it. We only populate what the active rule set actually
references — measured per-trigger, not pre-baked.

---

## Atom evaluators (the strategy pattern)

One evaluator function per `ConditionAtomKind`. Each is responsible
for:

- Resolving the fact slot from the bag
- Dispatching to the comparator
- Emitting a `trace` fragment for explainability

Adding a new fact = adding one function + registering it in
`ATOM_EVALUATORS`. Adding it to the schema is a separate step (see
`COMPILATION.md`).

`AtomVerdict` has both `matched` and `measurable`. A fact that wasn't
populated returns `{ matched: false, measurable: false, trace:
'<fact>: n/a' }` — the evaluator distinguishes "didn't match" from
"couldn't measure," which is what the trace shows.

---

## Combinator algebra

`evaluateTree` is a small mutually-recursive walker:

```ts
atom        → evaluateAtom + emit single-line trace
and(a..n)   → short-circuit on first false; combined trace
or(a..n)    → short-circuit on first true; combined trace
not(x)      → invert evaluateTree(x); single-level trace
```

Short-circuit order is left-to-right. This matters for the trace —
it reads top-down in the order the moderator wrote the rule. A
moderator looking at the audit explanation sees their own structure
mirrored back.

### Boolean laws (asserted by property tests)

`tests/property/CombinatorAlgebra.property.test.ts` proves:

- `not(not(x)) ≡ x` outcome-wise
- `and(a, b) ≡ and(b, a)` outcome-wise (commutativity)
- `or(a, b) ≡ or(b, a)` outcome-wise (commutativity)
- `normalize(normalize(x)) ≡ normalize(x)` (idempotence)
- `evaluate(normalize(x)) ≡ evaluate(x)` (normalisation preserves
  outcome)

The same property tests run on 100+ randomly generated trees per law,
so confidence in the algebra is empirical, not just "looks right."

---

## Normalisation

`normalize(tree)` performs minimal simplifications used by the
ConflictDetector to compare rules:

- `not(not(x))` collapses to `x`
- Same-kind nesting flattens: `and(a, and(b, c))` → `and(a, b, c)`
- Single-child combinators unwrap: `and(a)` → `a`

We do NOT apply distributive laws — they'd explode tree size for no
gain on conflict detection.

---

## Multi-clause ordering

Each rule contains 1..8 clauses. They evaluate in array order; first
to fire wins. The compiler emits the most-specific clause first (per
the system prompt's "CLAUSE ORDER" section), matching the moderator's
mental model: "the more specific description wins."

When a clause fires:

- `verdict` is taken
- `clauseName` and `clauseIndex` are recorded in the explanation
- subsequent clauses in the same rule are skipped

When NO clause fires:

- `evaluateRule` returns `null`
- the rule contributes nothing to the verdict set

---

## RuleSet evaluation

`evaluateRuleSet(rules, bag)` walks rules in priority order. Priority
within a set is determined by:

1. Effectiveness score descending (most effective first)
2. Phase: `live` before `shadowed`
3. `createdAt` ascending (older as tiebreaker)

This sort happens upstream in the orchestration layer; the evaluator
walks the array as-given.

The output bundles:

- `verdict` — the first rule that fired (or null)
- `shadowOnly` — whether that rule was in shadow phase
- `secondaryMatches` — every other rule that _would_ have fired,
  for conflict analytics

A rule that fires in shadow phase doesn't take live action; the
trigger handler writes `ShadowDecisionRecorded` instead of
`ActionTaken`.

---

## Explainability

Every match emits a `DecisionExplanation`:

```ts
{
  matched: true,
  shortLine: 'Fired "short post + new account" (2 atom checks matched)',
  fullTrace: [
    'clause: short post + new account',
    '  WHEN:',
    '    and: all-matched',
    '      atom[POSTLEN01] postLengthChars=30 cmp=lt ⇒ MATCH',
    '      atom[ACCTAGE01] accountAgeDays=4 cmp=lt ⇒ MATCH',
    '  result: FIRED',
  ],
  factSnapshot: { postLengthChars: 30, accountAgeDays: 4 },
}
```

`fullTrace` is stored verbatim on the event for 30 days. The
"Explain this decision" menu item reads it back. Mods don't need to
re-fetch the post to understand the rule's reasoning — even weeks
later.

---

## Performance budget

Target: < 1 ms per rule per evaluation on a 4-clause rule with a
6-atom condition tree, excluding Redis I/O.

Achieved in unit tests using deterministic clocks. The bottleneck in
practice is the Redis read for `active.rules` (single call per
trigger, ~1–3 ms on Devvit), not the algebra.

We deliberately don't optimise further (no caching, no precompiled
walkers) — the evaluator is fast enough, and the simplicity is worth
more than the extra cycles.
