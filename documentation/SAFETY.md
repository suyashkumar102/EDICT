# Safety

EDICT's safety posture has five layers, each independent of the others.
A failure in one doesn't compromise the rest.

---

## Layer 1 — schema validation (compile time)

Before any rule reaches the event store, it must:

- Parse against `compiledRuleSchema` (Zod, strict).
- Pass `ActionWhitelistPolicy.decideWhitelist` for every verdict.
- Have unique `atomId`s across all clauses.
- Have a `compilerConfidence` ≥ 0 ≤ 1.

A failure throws `SchemaValidationFailure` and the rule is rejected.
The compiler is NOT retried automatically — the moderator sees the
error and decides what to do.

Why this matters: a misbehaving LLM (drift, jailbreak, model outage)
can't produce an active rule that takes action. The boundary is
type-safe by construction.

---

## Layer 2 — adaptive shadow (runtime, pre-action)

`source/domain/policies/AdaptiveShadowPolicy.ts`. Every rule enters
shadow phase on activation. Shadow phase:

- Writes `ShadowDecisionRecorded` events with full fact-bag snapshot.
- Does NOT call `DevvitAdapter.executeAction`.
- Counts observations and shadow reversals.

The shadow-promotion-sweep scheduler runs every 10 minutes. For each
shadowed rule, it computes:

```
positives = observations − shadowReversals
posterior = (positives + 1) / (observations + 2)   // Laplace
reversalRate = shadowReversals / observations
```

Decision:

```
if reversalRate > 0.25:   hold (mod review)
elif observations < 25:   wait for more evidence (unless time cap)
elif posterior ≥ 0.92:    promote (adaptive-confidence)
elif now ≥ enteredAt+72h: promote (time-cap)
else:                     wait
```

The output is `RulePromoted` (with `reason: 'adaptive-confidence' |
'time-cap'`) or no event.

### Why Laplace smoothing

A naive `(positives / observations)` lets "10/10 = 100% confidence"
promote a rule that's seen ten posts. Laplace smoothing — adding 1 to
the numerator and 2 to the denominator — pulls the posterior toward
0.5 when n is small and toward the empirical rate when n is large.
With 10/10, posterior is `(10+1)/(10+2) = 0.917` — just under the
default 0.92 threshold, which is exactly the right answer.

---

## Layer 3 — circuit breakers (runtime, per-action)

`source/safety/CircuitBreakerService.ts` + `domain/policies/CircuitBreakerPolicy.ts`.

Two tiers:

1. **Per-rule** ceiling (default: 50 actions/hour)
2. **Subreddit-wide** ceiling (default: 200 actions/hour)

Counters live in Redis with 90-min TTL. Every action attempt:

```
ruleCount = incr(breaker:rule:<id>:<hour>)
subCount  = incr(breaker:sub:<sub>:<hour>)
if ruleCount > 50:  trip rule, throw CircuitBreakerOpen
if subCount > 200:  trip sub, throw CircuitBreakerOpen
```

Cooldowns are tiered by same-day recurrence:

| Trip # today | Cooldown |
| ------------ | -------- |
| 1            | 15 min   |
| 2            | 1 h      |
| 3+           | 4 h      |

The trip writes `CircuitBreakerTripped` event; the projection moves
the rule to `paused` until cooldown elapses. The next sweep clears
the pause once the cooldown expires.

### Why tiered cooldowns

A short cooldown lets a fundamentally-broken rule trip-and-retry
forever (10 trips in 10 minutes = 100 unwanted actions). A long
cooldown punishes a one-off spike (e.g. a brigade) unfairly. Tiering
gets both: a single trip recovers quickly; recurring trips force
human review.

---

## Layer 4 — undo learning (runtime, action-routing)

`source/safety/UndoLearningStrategy.ts`. The reversal-feedback loop.

When a moderator hits "Reverse this decision":

1. `ActionReversed` event fires.
2. EDICT fingerprints `(ruleId, clauseName, factBagSnapshot)`.
3. Increments the score on `learning:downweight:<sub>` for that
   fingerprint.

On every subsequent action, the runtime evaluator:

1. Computes the same fingerprint for the current evaluation.
2. Reads the score from `learning:downweight:<sub>`.
3. If score ≥ 3: deflects to mod queue instead of the original verdict.

Deflection means the rule **still records the event** (so the audit
log knows what would have happened) but the verdict is silently
re-routed. The audit entry's `summary` field notes the deflection
count.

### Decay

Patterns decay 1/week via the `rollback-window-sweep` scheduler.
Old patterns stop being downweighted automatically.

### Why 3

One reversal could be a one-off mistake. Two could be the mod's
general skepticism. Three is a meaningful pattern — small enough
to react quickly, large enough to avoid noise.

---

## Layer 5 — rollback tokens (post-action)

`source/safety/RollbackTokenService.ts`. Every reversible action
mints a token that captures everything needed to undo:

```ts
{
  tokenId: ULID,
  ruleId,
  thingId,
  verdict,
  takenAt, expiresAt,
  originalEventId,
}
```

Stored at `edict:rollback:<tokenId>` with TTL = `rollbackWindowDays`
days (default 30).

Redemption is one-shot — once redeemed (or expired), the token is
gone. This makes rollback safe to expose at the post/comment menu:
clicking "Reverse this decision" multiple times can't undo it twice.

Tokens are NOT minted for outgoing-message verdicts (`commentReply`,
`modmailNotify`) — the message can't be unsent.

---

## Layer 6 — consensus (activation gate)

`source/domain/policies/ConsensusPolicy.ts` + `safety/ConsensusCoordinator.ts`.

Three modes (per-subreddit setting):

| Mode     | Behaviour                                                  |
| -------- | ---------------------------------------------------------- |
| `off`    | Single mod can activate anything (default for v1.0)        |
| `risky`  | Rules with impact-weight ≥ 5 verdicts need 2 mod approvals |
| `strict` | Every activation needs 2 mod approvals                     |

The author's signature is implicit. To satisfy `required: 2`, **at
least one other moderator** must vote `approve` and **no moderator**
must vote `reject`.

When required but not yet met, `ActivateRule` throws
`ConsensusRequired`. The rule sits with `pendingConsensusVoters`
populated. Other mods see the pending rule in the Briefing panel.

### Impact weight

Each `ActionKind` has a numeric `impactWeight`:

| Kind                                | Weight |
| ----------------------------------- | ------ |
| modmailNotify, commentReply, report | 1      |
| flair, approve, sticky, distinguish | 2      |
| sendToModQueue, lock                | 3      |
| remove, contributorAdd              | 5      |
| mute, contributorRemove             | 7      |
| ban                                 | 10     |

`risky` mode triggers consensus when any clause's verdict is weight 5
or higher.

---

## The big picture

A rule must clear **all six layers** to take a live action:

```
        Layer 1  schema valid?
            │
            ▼
        Layer 2  past adaptive shadow?
            │
            ▼
        Layer 6  consensus satisfied (if required)?
            │
            ▼
        Layer 3  under per-rule + sub-wide ceilings?
            │
            ▼
        Layer 4  not deflected by undo-learning?
            │
            ▼
          ACT  (writes Layer 5 rollback token)
```

Five of the six layers are independent of LLM behaviour. Even if the
compiler produced a nonsensical rule, layers 2-5 would catch it
before any meaningful damage.
