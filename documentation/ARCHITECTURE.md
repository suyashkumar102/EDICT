# Architecture

EDICT is built on a deliberate stack of architectural choices, each picked
because it solves a real problem in this domain rather than because it
sounded clean on a slide.

This document is the field guide to those choices. Read top-to-bottom.

---

## Layer rules (the bedrock)

The whole codebase honours one rule: **dependencies point inward.**

```
   interface  →  orchestration  →  analytics  →  safety  →  evaluation  →  compilation  →  domain
                                       └→ infrastructure (event store, projections, Devvit, Redis, LLM)
```

- `domain/` knows nothing outside itself. Pure types, pure functions.
  No async, no I/O, no platform.
- `compilation/`, `evaluation/`, `safety/`, `analytics/` know only `domain/`
  and each other in the order shown above.
- `orchestration/` knows everything except `interface/`.
- `infrastructure/` is allowed to depend on `domain/` for shapes, but
  it implements _ports_ defined in higher layers — never the other way
  around.
- `interface/` is the leaf. It depends on `orchestration/`'s `CommandBus`
  and `QueryBus`, never directly on services or projections.

A change that would point the arrow the wrong way is rejected at code
review. ESLint's import-order rules + TypeScript path mapping enforce
this mechanically.

---

## Why event sourcing + CQRS

The naive shape for a Devvit moderation app is "store the current state
of rules in Redis, plus a flat log of recent decisions." This works
until someone asks "how did rule X end up where it is today?" or
"what was the rule set on March 12th?" — and the answer is **you
can't reconstruct it.**

EDICT inverts the default: every state change is a `DomainEvent`
appended to an **event store** (Redis ZSet, scored by `occurredAt`).
Aggregates and read models are _projections_ of the event log.

This gives us, for free:

1. **Time-travel.** "What did this rule look like on October 15?" is a
   one-liner: `replay(events.before(oct15))`. The What-If Studio uses
   this against the past 30 days of historical fact-bags to replay a
   draft rule against real history.

2. **Audit completeness.** An audit log built as a side-channel is
   inevitably a _summary_ of what happened. EDICT's event store IS
   what happened. The Audit Timeline panel reads a projection; if
   you ever doubt the projection, you can rebuild it from the event
   log.

3. **Compaction without losing context.** Old events stay; periodic
   snapshots make replay bounded.

4. **Test infrastructure.** Every test that exercises a rule's
   life-cycle just hands the event log to `replay()` and asserts on
   the resulting aggregate. No mocks, no fixtures, no setUp/tearDown.

The CQRS half — separating commands from queries — falls out naturally.
Commands change state by appending events. Queries read projections.
There's no "service that does both", which keeps each surface ~50
lines instead of 500.

---

## Hexagonal / ports & adapters

Each side of the application talks to the outside world through a
**port** (an interface defined in a high layer) implemented by an
**adapter** (a concrete class in `infrastructure/`).

| Port            | Defined in                                | Production adapter        | Test adapter                             |
| --------------- | ----------------------------------------- | ------------------------- | ---------------------------------------- |
| `EventStore`    | `infrastructure/eventstore/EventStore.ts` | `RedisEventStore`         | `RedisEventStore + InMemoryRedisGateway` |
| `RedisGateway`  | `infrastructure/redis/RedisGateway.ts`    | `DevvitRedisGateway`      | `InMemoryRedisGateway`                   |
| `LLMPort`       | `compilation/llm/CompilerService.ts`      | `OpenAiLLMClient`         | `FakeLLMClient` (per-test)               |
| `DevvitAdapter` | `infrastructure/devvit/DevvitAdapter.ts`  | `DevvitProductionAdapter` | `FakeDevvitAdapter`                      |
| `Clock`         | `shared/utilities/Clock.ts`               | `systemClock`             | `fixedClock` / `advancingClock`          |

The composition root (`source/bootstrap/CompositionRoot.ts`) wires
adapters to ports in exactly one place. Every other file accepts its
dependencies as parameters and is platform-agnostic.

---

## Why pure-TS runtime evaluation (no LLM at runtime)

A moderation rule that fires on every post must be:

- **Fast.** Sub-millisecond evaluation.
- **Deterministic.** Same input, same verdict, every time.
- **Replayable.** What-If Studio and Audit Explanations both depend on
  this.
- **Cheap.** Zero per-post API spend.
- **Inspectable.** When a mod hits "Explain this decision", the trace
  must be exact, not a re-prompt.

An LLM at runtime fails every one of these. The compiler is the _only_
place LLM tokens are spent, and only when a moderator hits "Compile."
The trade-off: the compiler must produce a JSON shape rich enough that
deterministic TS can do all the runtime work.

That shape is the **multi-clause combinator algebra** (`RuleClause` +
`ConditionTree`) — `AND`/`OR`/`NOT`/`UNLESS` over a fixed vocabulary of
fact atoms. The vocabulary is closed — listed exactly once in
`CompilerSystemPrompt.ts`, in `RuleSchema.ts`, and in `AtomEvaluators.ts`
— so the compiler can't invent facts the evaluator doesn't know about.

---

## Data shapes

### DomainEvent

Every event is an `EventEnvelope<Payload>`:

```ts
{
  eventId: ULID,
  subreddit: SubredditId,
  occurredAt: TimestampMs,
  actor: ModeratorId | 'system',
  payload: { kind: 'RuleDrafted' | 'RuleCompiled' | ... }
}
```

The 22 event kinds cover every state change. Versioning is a non-issue
because **event shapes are append-only** — to evolve a shape, add
`RuleCompiledV2` alongside `RuleCompiled`, and write a one-time
translator if you want old events to be readable by new code.

### RuleAggregate

The consistency boundary for a single rule. It owns:

- the current compiled version
- the history of prior versions (git-style)
- the shadow / live status
- the latest effectiveness snapshot
- the rule's circuit-breaker state

Aggregates are **immutable values** in TypeScript. State changes happen
by calling `apply(aggregate, event)` which returns the _next_ aggregate.
Hydrating from history is `events.reduce(apply, null)`.

### Read models (projections)

Each projection writes to its own Redis structure and answers exactly
one kind of query:

| Projection                           | Backing store                    | Powers                         |
| ------------------------------------ | -------------------------------- | ------------------------------ | ----- | --------------- |
| `ActiveRulesProjection`              | Hash, `ruleId → JSON(aggregate)` | rule list, evaluation hot path |
| `AuditTimelineProjection`            | ZSet, scored by time             | Audit panel                    |
| `BriefingFeedProjection`             | Capped list (50)                 | Briefing panel                 |
| `EffectivenessLeaderboardProjection` | ZSet, scored by score            | Leaderboard panel              |
| `ConflictMapProjection`              | Set of "A                        | B                              | kind" | Conflicts panel |

Adding a new view = adding a new projection. Nothing else changes.

---

## Hot path (post submitted → maybe acted on)

```
1. Reddit calls /internal/trigger/post-submitted with payload.
2. TriggerRoutes builds a RedditSnapshot from the payload.
3. Reads active rules from ActiveRulesProjection (single Redis call).
4. Computes the set of facts those rules reference (factsReferencedBy).
5. Builds a FactBag containing only those slots (no overfetching).
6. evaluateRuleSet returns the first verdict + secondaries.
7. If shadow-only: ShadowDecisionRecorded → event log + projections. Done.
8. If live: CircuitBreakerService.guard() — may throw CircuitBreakerOpen.
9. UndoLearningStrategy.shouldDeflect() — may route to mod queue instead.
10. RollbackTokenService.mint() — captures restore data.
11. DevvitAdapter.executeAction() — touches Reddit.
12. ActionTaken → event log + projections.
```

Total cost on a typical post: 1 Redis read for active rules, 1 to 3 for
breaker counters, 1 write for the action event. No LLM. No external API
beyond Reddit's own action call.

---

## Failure modes & their fixes

| Failure                     | What protects you                                        |
| --------------------------- | -------------------------------------------------------- |
| LLM emits garbage JSON      | Zod schema validation rejects before event is appended   |
| LLM tries a risky verdict   | `ActionWhitelistPolicy` rejects unless opt-in            |
| LLM is ambiguous            | Compiler returns `clarify` tool call → UI loop           |
| Rule fires too often        | Per-rule and sub-wide circuit breakers                   |
| Rule keeps getting reversed | Undo-learning loop downweights similar matches           |
| A mod has cold feet         | Rollback tokens, 30-day window                           |
| The mod team isn't aligned  | Consensus mode (2 mod approvals for risky rules)         |
| The projection drifts       | Compaction job rebuilds from event log nightly           |
| Devvit's Redis blips        | All projections are eventually-consistent and idempotent |

---

## What we deliberately did NOT do

- **No microservices.** Everything is one Devvit web app. The "layers"
  are folders, not deploys.
- **No distributed transactions.** Append-then-project is the closest
  thing; if a projection fails, the next compaction sweep fixes it.
- **No ORM.** The event store is a single Redis ZSet. The projections
  are typed; nothing else needs a mapper.
- **No GraphQL.** Each query is a typed DTO with a corresponding
  projection read. The cost of GraphQL would dwarf the benefit at this
  scale.
- **No client-side state machine.** The Command Center reads from
  projections and dispatches commands. The state lives server-side.

If you're tempted to add any of the above, ask "what does this solve?"
first — most of these come pre-bundled with their own problems.
