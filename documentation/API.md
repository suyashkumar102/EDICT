# API reference

Every command and query EDICT exposes. Used internally by routes and
custom posts; documented here for developers building on top of EDICT
or auditing its behaviour.

---

## Commands

Commands are _intent_. Dispatched via `CommandBus.dispatch(command)`.
Each emits zero or more `DomainEvent`s.

All commands share:

```ts
{
  subreddit: SubredditId,
  actor: ModeratorId,
  correlationId: ULID,
  // ...kind-specific fields
}
```

### `DraftRule`

Create a new rule from a moderator's English sentence.

```ts
{
  kind: 'DraftRule',
  englishSource: string,
  title: string,
  description: string,
  optInActions: ActionKind[],
}
```

Emits: `RuleDrafted`.

---

### `CompileRule`

Translate the latest English source on a rule into a compiled JSON
rule. Will throw `AmbiguousSentenceError` if clarification is needed.

```ts
{
  kind: 'CompileRule',
  ruleId: RuleId,
  model: string,            // 'gpt-5.4-mini' | 'gpt-5.4-nano' | 'gpt-5.4'
  verbosity: 'strict' | 'balanced' | 'permissive',
  optInActions: ActionKind[],
}
```

Emits: `RuleCompiled` (success) or `ClarificationRequested` (LLM needs
more info).

---

### `AnswerClarification`

Provide an answer to a pending clarification question.

```ts
{
  kind: 'AnswerClarification',
  ruleId: RuleId,
  answer: string,
}
```

Emits: `ClarificationAnswered`, then re-runs `CompileRule`.

---

### `ActivateRule`

Promote a `drafted` or `paused` rule to `shadowed`.

```ts
{
  kind: 'ActivateRule',
  ruleId: RuleId,
  consensusMode: 'off' | 'risky' | 'strict',
}
```

Emits: `RuleActivated`. May throw `ConsensusRequired` if more mod
approvals are needed.

---

### `PauseRule` / `ResumeRule`

Toggle a rule's active state.

```ts
{ kind: 'PauseRule',  ruleId: RuleId, note?: string }
{ kind: 'ResumeRule', ruleId: RuleId, note?: string }
```

Emits: `RulePaused` / `RuleResumed`.

---

### `ArchiveRule`

Soft-delete a rule. Archived rules stop evaluating but their history
is retained in the event log forever.

```ts
{ kind: 'ArchiveRule', ruleId: RuleId, reason: string }
```

Emits: `RuleArchived`.

---

### `AmendRule`

Replace a rule's English source with a new one. Creates a new version;
the old version is retained.

```ts
{
  kind: 'AmendRule',
  ruleId: RuleId,
  newEnglishSource: string,
  optInActions: ActionKind[],
}
```

Emits: `RuleAmended`, then `RuleCompiled` for the new version.

---

### `RevertRule`

Roll a rule back to a previous version.

```ts
{
  kind: 'RevertRule',
  ruleId: RuleId,
  toVersion: RuleVersion,
}
```

Emits: `RuleReverted`.

---

### `CastConsensusVote`

Cast an approve/reject vote on a pending activation.

```ts
{
  kind: 'CastConsensusVote',
  ruleId: RuleId,
  vote: 'approve' | 'reject',
  note?: string,
}
```

Emits: `ConsensusVoteCast`.

---

### `ReverseAction`

Undo a live action via its rollback token.

```ts
{
  kind: 'ReverseAction',
  rollbackTokenId: ULID,
  note?: string,
}
```

Emits: `ActionReversed`. May throw `RollbackWindowExpired`.

---

### `ImportTemplate`

Fork a template from the gallery into a new draft rule.

```ts
{ kind: 'ImportTemplate', templateSlug: string }
```

Emits: `TemplateImported`, then `RuleDrafted`.

---

### `RunWhatIf`

Replay a draft rule against the last N days of event history.

```ts
{
  kind: 'RunWhatIf',
  ruleId: RuleId,
  windowDays: number,   // 1..30
}
```

Returns: `WhatIfReport` (does not emit a domain event — it's
read-side analytics).

---

## Queries

Queries return data. Dispatched via `QueryBus.ask(query)`.

### `GetCommandCenterDigest`

The top-ribbon stats shown on the main dashboard.

```ts
{ kind: 'GetCommandCenterDigest', subreddit: SubredditId }
```

Returns:

```ts
{
  activeRuleCount: number,
  shadowRuleCount: number,
  recentAuditEntries: number,
  latestBriefingSummary: string,
  conflictCount: number,
  topRule: { ruleId, title } | null,
}
```

---

### `GetActiveRules`

List rules, optionally including paused.

```ts
{
  kind: 'GetActiveRules',
  subreddit: SubredditId,
  includePaused?: boolean,
}
```

Returns: `RuleAggregate[]`.

---

### `GetRuleDetail`

Read a single rule's full aggregate.

```ts
{
  kind: 'GetRuleDetail',
  subreddit: SubredditId,
  ruleId: RuleId,
}
```

Returns: `RuleAggregate | null`.

---

### `GetAuditTimeline`

Recent audit entries.

```ts
{
  kind: 'GetAuditTimeline',
  subreddit: SubredditId,
  limit: number,
  category?: 'lifecycle' | 'action' | 'safety',
  ruleId?: RuleId,
}
```

Returns: `AuditEntry[]`.

---

### `GetBriefingFeed`

Hourly briefings.

```ts
{
  kind: 'GetBriefingFeed',
  subreddit: SubredditId,
  since?: TimestampMs,
}
```

Returns: `BriefingSnapshot[]`.

---

### `GetEffectivenessLeaderboard`

Top N rules by effectiveness score.

```ts
{
  kind: 'GetEffectivenessLeaderboard',
  subreddit: SubredditId,
  top: number,
}
```

Returns: `LeaderboardEntry[]`.

---

### `GetConflictMap`

Detected conflicts.

```ts
{
  kind: 'GetConflictMap',
  subreddit: SubredditId,
  ruleId?: RuleId,
}
```

Returns: `ConflictRecord[]`.

---

### `GetWhatIfReport`

A previously computed What-If report. The actual computation happens
via `WhatIfStudio.replay`; this query returns a cached result.

```ts
{
  kind: 'GetWhatIfReport',
  subreddit: SubredditId,
  ruleId: RuleId,
}
```

Returns: `WhatIfReport | null`.

---

### `GetTemplateGallery`

List templates, optionally filtered by category.

```ts
{
  kind: 'GetTemplateGallery',
  subreddit: SubredditId,
  category?: 'safety' | 'quality' | 'spam' | 'civility' | 'moderation' | 'community',
}
```

Returns: `RuleTemplate[]`.

---

## Events

The 22 `DomainEvent` kinds. Defined in `domain/events/DomainEvent.ts`.

| Kind                      | Emitted by                   | Notes                   |
| ------------------------- | ---------------------------- | ----------------------- |
| `RuleDrafted`             | `DraftRule` command          | initial state           |
| `ClarificationRequested`  | `CompileRule` (ambiguous)    | UI shows clarify form   |
| `ClarificationAnswered`   | `AnswerClarification`        | feeds into next compile |
| `RuleCompiled`            | `CompileRule` (success)      | creates new version     |
| `RuleActivated`           | `ActivateRule`               | enters shadow           |
| `ShadowDecisionRecorded`  | runtime evaluator            | shadow-phase match      |
| `RulePromoted`            | `AdaptiveShadowOrchestrator` | shadow → live           |
| `RulePaused`              | `PauseRule` or breaker       | stops evaluation        |
| `RuleResumed`             | `ResumeRule`                 | restarts evaluation     |
| `RuleArchived`            | `ArchiveRule`                | soft delete             |
| `RuleAmended`             | `AmendRule`                  | new version on top      |
| `RuleReverted`            | `RevertRule`                 | restore prior version   |
| `ActionTaken`             | runtime evaluator            | live action             |
| `ActionReversed`          | `ReverseAction`              | feeds undo-learning     |
| `ConsensusVoteCast`       | `CastConsensusVote`          | gates activation        |
| `CircuitBreakerTripped`   | `CircuitBreakerService`      | safety trip             |
| `CircuitBreakerReset`     | breaker scheduler            | cooldown elapsed        |
| `BriefingPrepared`        | `BriefingComposer`           | hourly snapshot         |
| `EffectivenessRecomputed` | `EffectivenessScorer`        | 2-hourly sweep          |
| `ConflictDetected`        | `ConflictDetector`           | post-compile scan       |
| `SuggestionGenerated`     | `SuggestionEngine`           | mining results          |
| `TemplateImported`        | `ImportTemplate`             | gallery fork            |
