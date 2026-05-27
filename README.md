# EDICT

**English-Declared, Inspected, Compiled, Traced.**

Write moderation policy in plain English. EDICT compiles it into deterministic rules — shadow-tested against real history, fully explainable, and reversible for 30 days.

---

## Why moderators use it

- Replace AutoModerator YAML and regex with a single English sentence
- Replay every new rule against 30 days of actual subreddit history before it acts on anything
- Run every new rule in adaptive shadow mode — it observes and logs before it ever takes action
- See the exact clause, atom, and measured value behind every moderation decision
- Undo any mistake with one click, up to 30 days later
- The AI never reads posts, comments, or usernames — only the sentence you type

---

## Example

A moderator types:

> _"Send to mod queue any post under 50 characters from accounts younger than 7 days, unless the author has more than 500 karma."_

EDICT compiles this into a deterministic rule with explicit conditions and a karma exception. Before activation, the moderator replays it against 30 days of subreddit history to see exactly what it would have caught — including removed posts that are no longer visible. The rule then enters adaptive shadow mode, logging decisions without acting. When its confidence crosses a configurable threshold, it promotes itself to live automatically.

Every decision it makes is explainable:

```
clause: short post + new account
  WHEN:
    and: all-matched
      atom[POSTLEN01] postLengthChars=30 cmp=lt => MATCH
      atom[ACCTAGE01] accountAgeDays=4 cmp=lt => MATCH
  UNLESS: authorKarma=620 cmp=gt 500 => NO BYPASS
  result: FIRED
```

If the rule ever acts on something the moderator disagrees with, one click reverses it.

---

## What makes EDICT different

**Multi-clause rules with AND / OR / NOT / UNLESS.** Real moderation policy is rarely a single sentence. EDICT supports up to eight clauses per rule, each with its own condition tree and exception logic. A single EDICT rule can express what would otherwise require several parallel AutoModerator entries — and because the clauses share one shadow window and one effectiveness score, the mod team reasons about them as one policy.

**Historical replay, not just a preview.** Most tools preview a rule against currently-visible posts. EDICT replays against persisted fact-bag snapshots from the last 30 days — including removed posts, archived comments, and content that no longer exists. The What-If Studio shows the false-positive rate (posts the rule would have caught that a moderator subsequently approved) and the redundancy rate (posts already caught by another active rule). This is the answer to "is this rule safe to activate?" before it has ever touched a live post.

**Adaptive shadow, not a fixed timer.** Shadow mode is evidence-based. EDICT tracks how often the rule would have fired and how often those decisions would have been reversed. When confidence is high enough, the rule promotes itself. When confidence is low — because the reversal rate is too high — it stays in shadow indefinitely and surfaces for human review. A rule that keeps getting reversed never goes live on its own.

**Six independent safety layers.** Schema validation, adaptive shadow, per-rule and subreddit-wide circuit breakers, undo-learning deflection, consensus voting for high-impact verdicts, and 30-day rollback tokens. A failure in any one layer does not compromise the others. Even a misbehaving LLM cannot produce an active rule that takes action — validation happens after the model returns.

**The AI never reads your community's content.** The model runs once, when a moderator clicks Compile. It reads only the sentence the moderator typed. Every post evaluation after that is pure TypeScript — deterministic, free, and fully traceable. The same post always gets the same verdict.

**Your API key, your infrastructure.** EDICT supports both OpenAI and Gemini. The moderator installs their own key via Devvit's encrypted settings store. There is no shared quota, no per-compile billing through a third party, and no dependency on another service's uptime.

---

## Installing

```bash
git clone <repo> edict
cd edict
npm install
npm run build
npx devvit upload
npx devvit install r/your-subreddit
```

After upload, set your API key:

```bash
npm run secret:gemini   # for Gemini (free tier available)
npm run secret:openai   # for OpenAI
```

Open your subreddit's mod tools, go to Installed Apps, find EDICT, and set the Compiler provider and Compiler model to match your key. Leave Sandbox mode on until you are ready for rules to take live action.

Full installation guide: `documentation/INSTALL.md`

---

## Using EDICT

**Compose a rule.** Subreddit menu -> EDICT - Compose new rule. Type the rule in plain English, give it a short title, click Compile. If the sentence is ambiguous, EDICT asks a clarifying question rather than guessing.

**Activate it.** Subreddit menu -> EDICT - Activate LIVE. The rule enters adaptive shadow mode immediately.

**Monitor it.** Subreddit menu -> EDICT - Open Command Center. All rules with live match counts and effectiveness scores. Select any rule to pause, resume, archive, or delete.

**Explain a decision.** On any post or comment -> three dots -> EDICT - Explain this decision. Returns the exact clause and atoms that fired, with measured values.

**Reverse a decision.** On any post or comment -> three dots -> EDICT - Reverse this decision. Executes the inverse action and logs the reversal.

**Run What-If.** Subreddit menu -> EDICT - Run What-If. Select a rule and a lookback window. EDICT replays against stored event history and reports fire rate, false-positive rate, and example matches.

---

## Verdict options

Safe (available by default): `report` `flair` `lock` `sendToModQueue` `approve` `sticky` `distinguish` `commentReply` `modmailNotify`

Risky (require explicit opt-in at compose time): `remove` `mute` `ban` `contributorAdd` `contributorRemove`

---

## Per-subreddit settings

| Setting                     | Default | Description                                                         |
| --------------------------- | ------- | ------------------------------------------------------------------- |
| `sandboxMode`               | on      | Master kill switch. Rules log decisions but never act.              |
| `adaptiveShadow`            | on      | Promote based on confidence, not a fixed timer.                     |
| `shadowConfidenceThreshold` | 0.92    | Posterior probability required to promote from shadow.              |
| `shadowMinObservations`     | 25      | Minimum shadow decisions before promotion is considered.            |
| `shadowMaxHours`            | 72      | Hard cap on shadow duration if confidence never reaches threshold.  |
| `perRuleActionCeiling`      | 50      | Actions per hour before a rule's circuit breaker trips.             |
| `subwideActionCeiling`      | 200     | Actions per hour across all rules before the subreddit brake trips. |
| `consensusRequired`         | risky   | Whether high-impact rules require a second moderator's approval.    |
| `rollbackWindowDays`        | 30      | How long reversal tokens remain valid.                              |

---

---

# Engineering reference

_Everything below is for developers and technically-minded judges. The product is fully described above._

---

## The core idea

The AI runs exactly once — when a moderator writes a rule. It reads only the sentence the moderator typed, turns it into a structured rule, and is done. Every post evaluation after that is pure TypeScript: deterministic, free, and fully traceable. The same post always gets the same verdict. There is no per-post model call, no rate limit, no hallucination risk at runtime.

This is not a natural-language wrapper around AutoModerator. It is a compiled rule engine with its own condition algebra, its own safety model, and its own audit infrastructure.

---

## Multi-clause combinator algebra

Each clause's condition is a tree of `AND` / `OR` / `NOT` nodes over atomic fact comparisons. The `UNLESS` keyword is first-class: it compiles to a negated subtree that cancels the `WHEN` match. Up to eight clauses per rule, each with its own `WHEN` / `UNLESS` / `THEN`.

The fact vocabulary is closed and fixed:

```
postLengthChars       commentLengthChars    accountAgeDays
authorKarma           authorVerifiedEmail   titleMatchesPattern
bodyMatchesPattern    titleAllCaps          titleQuestionMark
hasLink               domainEqualsAnyOf     subredditAgeMinutes
reportCount           uniqueReporterCount   flairEqualsAnyOf
isSelfPost            isCrosspost           postScoreAfterMinutes
replyCountAfterMinutes   authorBannedInOtherSubInLastDays
authorHasModMail      timeOfDayHourUtc
```

Every atomic condition carries a stable `atomId` (6–16 uppercase alphanumeric characters, unique within the rule). This is what makes per-atom explanation traces possible: every match references the exact atom that satisfied it, by ID, with the measured value and the comparator result.

---

## Safety model

A rule must clear six independent layers before it can take a live action.

**Layer 1 — Schema validation.** The compiled JSON must parse against `compiledRuleSchema` (Zod, strict mode), pass `ActionWhitelistPolicy` for every verdict, and have unique atom IDs across all clauses. A misbehaving LLM cannot produce an active rule by construction.

**Layer 2 — Adaptive shadow.** Promotion is evidence-based, not time-based:

```
posterior = (positives + 1) / (observations + 2)   // Laplace smoothing
promote   = observations >= 25
         && reversalRate <= 25%
         && posterior >= 0.92
```

A rule with 30 shadow decisions and 1 reversal hits confidence 0.94 and promotes within hours. A rule with 30 decisions and 10 reversals never promotes automatically.

**Layer 3 — Circuit breakers.** Per-rule ceiling (default 50 actions/hour) and subreddit-wide ceiling (default 200). Cooldowns are tiered: 15 minutes on the first trip, 1 hour on the second, 4 hours on the third and beyond.

**Layer 4 — Undo-learning deflection.** After three reversals of the same pattern (rule + clause + fact-bag fingerprint), future matches are silently re-routed to the mod queue. Patterns decay weekly.

**Layer 5 — Consensus voting.** High-impact verdicts (remove, mute, ban) can require a second moderator's approval before activation.

**Layer 6 — Rollback tokens.** Every reversible action mints a one-shot token. Tokens expire after the rollback window. Outgoing messages are explicitly marked irreversible at the type level.

---

## Architecture

EDICT is an event-sourced system. Every state change is an immutable event appended to a per-subreddit event log in Devvit Redis. Aggregates and read models are projections of the event log.

The dependency graph is strictly layered:

```
interface -> orchestration -> analytics -> safety -> evaluation -> compilation -> domain
                                  └-> infrastructure (event store, projections, Redis, LLM)
```

`domain/` is pure TypeScript with no async, no I/O, and no platform dependencies. The evaluator is a pure function: `(rules, factBag) -> verdict | null`. No side effects, no network calls, no randomness.

Each projection writes to its own Redis structure:

| Projection                           | Backing store                       | Powers                         |
| ------------------------------------ | ----------------------------------- | ------------------------------ |
| `ActiveRulesProjection`              | Hash, ruleId to JSON aggregate      | Rule list, evaluation hot path |
| `AuditTimelineProjection`            | Sorted set, scored by time          | Audit panel                    |
| `BriefingFeedProjection`             | Capped sorted set (50 entries)      | Briefing panel                 |
| `EffectivenessLeaderboardProjection` | Sorted set, scored by effectiveness | Leaderboard panel              |
| `ConflictMapProjection`              | Sorted set of conflict pairs        | Conflicts panel                |

Hot path on a post submission: one Redis read for active rules, one to three reads for circuit breaker counters, one write for the action event. No LLM. No external API beyond Reddit's own action call.

Full architecture documentation: `documentation/ARCHITECTURE.md`

---

## Development

```bash
npm run typecheck          # tsc --noEmit
npm run verify             # vitest run (185 tests)
npm run verify:property    # property-based tests (fast-check)
npm run acceptance         # cross-layer acceptance gates (G1-G4)
npm run doctor             # pre-deploy integrity checks
npm run gate               # full CI gate: all of the above in sequence
npm run dev                # devvit playtest (live reload)
npm run compile:smoketest  # real LLM call against 6 canonical inputs
```

The acceptance gate runs four cross-layer invariants before every publish: schema rejects every category of malformed input (G1), the evaluator is deterministic across 1000 runs on the same input (G2), every verdict kind dispatches to the correct Reddit API method (G3), and the full rule lifecycle round-trips through the event store and projections (G4).

---

## Permissions

- `reddit` — moderation actions on posts and comments; author metadata (karma, account age, verified email) at evaluation time. Reddit content is never sent to any external service.
- `redis` — event log, rule projections, rollback tokens, circuit breaker counters, effectiveness scores, undo-learning downweight table.
- `http` (`api.openai.com`, `generativelanguage.googleapis.com`) — rule compilation at rule-edit time only. No post or comment content is ever included.

---

## License

BSD-3-Clause
