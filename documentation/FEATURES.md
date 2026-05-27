# Features

Every capability EDICT ships with, organised by mod-facing surface and
explained in one paragraph each. Headline capabilities are tagged
**★ flagship**.

---

## Compose Rule

### Multi-clause natural-language input ★ flagship

Mods can describe rules with arbitrary chains: "WHEN A AND B, THEN
modqueue UNLESS C; AND WHEN D, THEN flair as X." The compiler emits up
to **8 clauses** per rule, each with its own `WHEN`/`UNLESS`/`THEN`.
A single EDICT rule can express what would otherwise require several
parallel rules — and because the clauses share one shadow window and
one effectiveness score, the mod team reasons about them as one
policy, not several.

### Combinator algebra (AND/OR/NOT/UNLESS) ★ flagship

Each clause's `WHEN` (and optional `UNLESS`) is a tree of nested
`AND` / `OR` / `NOT` over atomic conditions. `UNLESS` is sugar for
"WHEN matches and `unless` does NOT match." The runtime evaluator
walks the tree with short-circuit semantics; the evaluation order is
the order the compiler emitted, which means the explanation trace
reads top-down the way a human writes the rule.

### Ambiguity-aware compilation

When the moderator's sentence is genuinely ambiguous, the compiler
asks a clarifying question instead of guessing. It uses _function
calling_ to distinguish "I know what you mean" (`compileRule` tool
call) from "I need to ask" (`clarify` tool call). The compiler is
forbidden from emitting prose; structurally invalid responses fail
fast.

### Multi-round clarification

EDICT supports up to **3 rounds** of clarification per draft. Each
answer is appended to the prompt as a captured `Q/A`, and re-compiled
deterministically. After 3 rounds, EDICT surfaces the full chain to
the mod with a "rewrite from scratch" option.

### Atom-id uniqueness enforcement ★ flagship

Every atomic condition in a rule gets a stable 6–16-char `atomId`.
The compiler must produce unique ids within a rule; duplicates fail
validation. This is what makes per-clause explanations possible at
runtime — every match references the exact atom that satisfied it.

### Risky-verdict opt-in

`remove` / `mute` / `ban` / `contributorAdd` / `contributorRemove`
require an explicit moderator checkbox to be permitted. Without the
checkbox, the schema validator rejects the compiled rule outright.
This is structurally enforced — the LLM can't bypass it because
validation happens _after_ the LLM returns.

---

## What-If Studio

### Historical replay against 30 days of events ★ flagship

The Studio replays a draft rule against the actual fact-bag stream
from your subreddit's last 30 days. Because every `ShadowDecisionRecorded`
and `ActionTaken` event captures the full fact-bag snapshot at the
time, replay is bit-exact: the rule sees the same numbers it would
have seen if it had been active when the post happened.

A current-state preview can only scan what's still visible — removed
posts disappear, comments are missing, and you can't simulate what
_would_ have been removed. The Studio sidesteps this by reading the
persisted snapshots, so removed items still count toward the replay.

### False-positive surface ★ flagship

For every post the draft would have fired on, the Studio cross-
references the audit log to see whether a mod ever manually approved
that thing. The result is a "mod-approved overlap" count — if it's
above 25%, the Studio surfaces it in red, since that's a strong
signal the draft is over-broad.

### Redundancy detection ★ flagship

Same cross-reference but against `ActionTaken` events from other
rules. If 80% of what the draft catches is already caught by another
rule, the Studio flags it as redundant — and links to the existing
rule for inspection.

### Side-by-side rule comparison

The Studio's bottom panel shows the overlap percentage against every
currently-active rule. Mods can spot "Rule A and Rule B both fire on
these 12 things" before activation, not after.

---

## Activate

### Adaptive shadow mode ★ flagship

Rather than a fixed time window, EDICT promotes when
**evidence is sufficient**:

```
posteriorRate = (positives + 1) / (observations + 2)  // Laplace
shouldPromote = observations >= minObs
             && reversalRate <= 25%
             && posteriorRate >= threshold
```

Defaults: `minObs = 25`, `threshold = 0.92`, `reversalRate cap = 25%`.
A rule with 30 shadow decisions, 1 reversal, hits confidence 0.94 and
promotes within hours. A rule with 30 decisions and 10 reversals
**never promotes**, even after the hard time cap — it's surfaced for
human review instead.

### Per-rule circuit breakers ★ flagship

EDICT runs two breakers in parallel: a **per-rule** ceiling
(default 50 actions/hour) and a **sub-wide** ceiling (default 200).
A single misbehaving rule trips without taking other rules down,
and a coordinated burst across multiple rules still has a master
brake.

### Tiered cooldowns

First trip in a day: 15 min cooldown. Second: 1 h. Third or later:
4 h. Prevents flapping when a rule is fundamentally broken — a
fast-recovery breaker would just trip again on the next post.

### Mod-consensus workflow ★ flagship

Subreddit setting `consensusRequired`:

- `off` — single mod can activate anything
- `risky` — rules with impact-weight-≥-5 verdicts (remove/mute/ban)
  need 2 mod approvals
- `strict` — every activation needs 2 mod approvals

When required but not yet satisfied, activation throws
`ConsensusRequired` and the rule sits with `pendingConsensusVoters`.
Other mods get a notification through the Briefing panel.

### Staged rollout

Subreddit setting `rolloutPercent` (default 100) limits a freshly-
activated rule to match a random sample of eligible content. Mods
can roll out a contentious rule to 10% of posts, watch for a day,
ramp to 50%, then 100%. (v1.1 — currently respects 100/0 only.)

---

## Live runtime

### Decision explainability ★ flagship

Every action records the full per-atom trace:

```
clause: short post + new account
  WHEN:
    and: all-matched
      atom[POSTLEN01] postLengthChars=30 cmp=lt ⇒ MATCH
      atom[ACCTAGE01] accountAgeDays=4 cmp=lt ⇒ MATCH
  UNLESS: (none)
  result: FIRED
```

The "Explain this decision" menu item surfaces this verbatim. Mods
can see _why_ the rule fired without re-fetching the post, even 28
days later.

### Undo-learning loop ★ flagship

When a mod hits "Reverse this decision," EDICT fingerprints the
fact-bag values + rule + clause and stores it in a ZSet. After **3**
undos of the same pattern, EDICT deflects future matches to the mod
queue with a note: "this pattern was reversed N times." Scores decay
1/week so old patterns don't haunt new posts.

EDICT undoes aren't one-shot corrections; they're training signal
that quietly improves the rule's future behaviour without the mod
having to amend it by hand.

### Rollback tokens

30-day TTL by default (configurable 1–90). Every reversible action
mints a token capturing what's needed to restore. One-shot — once
redeemed, the token's gone.

### Pattern deflection ★ flagship

The live evaluator consults the undo-learning ZSet before acting. A
pattern that's been undone 3+ times is silently re-routed to mod
queue instead of taking the original action. The audit entry notes
the deflection.

---

## Audit

### Event-sourced timeline ★ flagship

EDICT's audit is the full event log: drafts, compiles, activations,
shadow decisions, live actions, reversals, consensus votes, breaker
trips, conflicts, suggestions, briefings — all in one place, all
queryable, all replayable.

### Category filtering

Three filters in one click:

- **Lifecycle** — drafts/compiles/activations (rule state)
- **Action** — shadow decisions + live actions + reversals
- **Safety** — breakers, conflicts, consensus votes

### Per-rule timeline

Drilling into a rule shows just its events. Useful for the "what
exactly has Rule X done over the last week?" question.

### Time-travel queries ★ flagship

Because the event log is the source of truth, any historical
question is answerable. `replay(events.before(T))` produces the rule
set as it was at time T.

---

## Effectiveness

### Score formula

```
effectiveness = max(0, (matches - reversals - conflictPenalties) / max(matches, 1))
```

`conflictPenalties` is the count of times a stricter rule overrode
this one's verdict on the same item. Computed every 2 h.

### Grade letters

`excellent ≥ 0.95`, `strong ≥ 0.85`, `fair ≥ 0.7`, `weak ≥ 0.5`,
`failing < 0.5`. Color-coded throughout the UI.

### Top performers and retire list ★ flagship

The Effectiveness panel splits rules into:

- **Top performers** (≥ 0.85): keep doing what they're doing
- **Retire candidates** (< 0.5 with > 10 matches): probably hurting

The middle band is intentionally not shown — it requires human
judgment and we don't want to push mods toward action there.

---

## Conflicts

### Static analyzer ★ flagship

After every compile, EDICT scans the new rule against every active
rule for three kinds of conflict:

- **Overlap**: same `WHEN` shape, same verdict ⇒ redundant
- **Contradiction**: same `WHEN` shape, opposite verdicts ⇒ they
  disagree on the same thing
- **Shadowing**: one rule's `WHEN` is a strict subset of another's,
  so depending on order one may never fire

Without a conflict detector, a mod team can write two rules that
both fire on the same post and never know. EDICT surfaces every
pair on every compile.

### Inline resolution ★ flagship

The Conflicts panel shows each pair with "Open A" / "Open B" /
"Mark resolved" actions. Resolution is informational — EDICT doesn't
auto-change either rule. The fix is the mod's call.

---

## Briefing

### Hourly mod handoff ★ flagship

The briefing-prepare scheduler assembles a snapshot every hour at :00.
The snapshot contains:

- actions taken this hour
- shadow decisions this hour
- reversals this hour
- top 5 rules by match count
- anomalies (see below)

### Anomaly detection ★ flagship

Heuristics tuned for "what would a tired mod want to know?":

- action volume 3× the trailing 12-hour baseline
- any rule's reversal rate > 25% with ≥ 8 matches
- circuit breaker tripped at least once
- new conflict detected since last briefing

A briefing with zero anomalies collapses to one line; a noisy hour
gets a red sidebar.

---

## Suggestions

### Audit-mining engine ★ flagship

Reads the last 30 days of `ActionTaken` (kind=remove, not reversed),
groups by 3-fact signature, and produces a `SuggestionGenerated`
event for any cluster of ≥ 5 manual removals with the same signature.

The mod-facing card shows the proposed English sentence and a
"Compose this rule" button that pre-fills the Composer. Mods get
data-driven prompts based on their own removal patterns instead
of having to write every rule from scratch.

---

## Template gallery

### 30+ curated rule templates

Six categories (safety / quality / spam / civility / moderation /
community), all hand-authored, all using only safe verdicts, all with
a suggested shadow duration. Mods import → fork → edit; nothing is
auto-activated.

---

## Settings

### Per-subreddit tunables

- `sandboxMode` — master kill switch (rules log decisions, never act)
- `adaptiveShadow` — adaptive promotion on/off
- `shadowConfidenceThreshold` — 0.5..1.0 (default 0.92)
- `shadowMinObservations` — 5..500 (default 25)
- `shadowMaxHours` — 1..168 (default 72)
- `perRuleActionCeiling` — 1..10000 (default 50)
- `subwideActionCeiling` — 1..10000 (default 200)
- `rolloutPercent` — 0..100 (default 100)
- `consensusRequired` — off / risky / strict
- `rollbackWindowDays` — 1..90 (default 30)

Each has a validation endpoint so bad values can't be saved.

### Per-installation globals

- `openaiApiKey` (encrypted) — set via `npx devvit settings set openaiApiKey`
- `compilerModel` — gpt-5.4-mini / nano / gpt-5.4
- `compilerVerbosity` — strict / balanced / permissive

---

## Custom-post Command Center

### Six-tab dashboard ★ flagship

EDICT ships a custom-post dashboard with six panels:

1. **Rules** — every rule, color-coded by phase, with inline actions
2. **Effectiveness** — top performers and retire candidates
3. **Audit** — event-sourced timeline with category filter
4. **Briefing** — hourly handoff cards
5. **Conflicts** — overlap / contradiction / shadowing
6. **Suggestions** — audit-mined proposals

### Rule Composer post ★ flagship

Full-screen composer with side-by-side English input + compiled-clause
preview. Each clause card shows the parsed `WHEN`/`UNLESS`/`THEN` so
mods can verify the LLM's reading before activating.

### What-If Studio post ★ flagship

Interactive simulator. Rule picker + window slider + replay button +
gauges for fired / mod-approved / redundant + 8 example matches.
