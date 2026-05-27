# Hackathon submission summary

Built for the **Reddit Mod Tools and Migrated Apps Hackathon · 2026**.
Targeting **Best New Mod Tool**.

---

## The 5-second pitch

**Type a moderation rule in English. EDICT compiles it, tests it on
your sub's last 30 days, runs it in shadow until it's safe, and gives
you 30-day undo on everything it does.**

That's the entire product. The rest of this doc is how.

---

## The 30-second demo

A moderator opens **Command Center → Compose** and types:

> _"Send to mod queue any post under 50 characters from accounts less
> than 7 days old — unless the post has more than 5 karma in the first
> 10 minutes."_

1. **EDICT compiles it** (one OpenAI call, on the sentence only) into a
   structured JSON rule with combinator algebra (AND / OR / NOT / UNLESS).
2. **Click _What-If_** — EDICT replays the draft against 30 days of
   captured fact-bags from your sub and shows: "would have fired on 84
   posts; 12 were later mod-approved (false-positives); 7 were removed
   by another rule (overlap)."
3. **Activate** — the rule enters **shadow mode**, recording what it
   _would_ have done without doing it. Adaptive promotion lifts it to
   live action once confidence ≥ 0.92 on ≥ 25 observations, not on a
   fixed timer.
4. **Every live action gets a 30-day rollback token.** If a mod clicks
   _Reverse this decision_, EDICT restores the post **and** hashes the
   fact-pattern that fired so similar future matches are de-weighted.

---

## What's underneath

Event-sourced + CQRS with hexagonal layering, which makes time-travel
queries, replay-based debugging, and the What-If Studio fall out of the
design for free. The LLM is called **once, at rule-edit time, on the
moderator's sentence only** — never on Reddit content, never at
evaluation time. The full domain allowlist (`http.permissions.domains`
in `devvit.json`) is one entry: `api.openai.com`.

---

## How moderators use the app

1. Install EDICT from the App Directory.
2. Pin **EDICT · Open Command Center** to the sub via the menu item.
3. Six tabs in the Command Center: Rules, Effectiveness, Audit,
   Briefing, Conflicts, Suggestions.
4. **Compose**: Mod Tools → "EDICT · Compose new rule" → type in
   plain English → Compile + What-If → Activate.
5. **Review**: Adaptive shadow mode logs every decision for 24–72 h
   without acting; once confident, the rule auto-promotes.
6. **Reverse**: Any action's `…` menu shows "EDICT · Reverse this
   decision" for 30 days.
7. **Mine your own audit**: The Suggestions tab proposes new rules
   from patterns of past manual removals.

---

## Project impact

### Communities that benefit immediately

1. **Mid-sized lifestyle subs (e.g. r/personalfinance,
   r/explainlikeimfive)** — high-volume, broad rule sets, frequent
   "is this within the rules?" debates between mods. EDICT's
   multi-clause rules let them express nuanced policies (e.g. "low
   karma + new account + linkpost → modqueue, but unless they have
   positive karma in this sub") as a single rule, and the conflict
   detector keeps the rule set clean as it grows.

2. **High-drama discussion subs (e.g. r/AskReddit, r/popular default
   subs)** — get hit with brigading regularly. EDICT's per-rule
   circuit breakers and undo-learning loop mean a misfiring rule
   doesn't punish 200 posts before a human notices, and reversal
   patterns inform future rule decisions automatically.

3. **Niche moderation-heavy subs (e.g. r/science with its strict
   academic-source rule)** — strict source-of-truth communities
   where rule precision matters. EDICT's explainability (per-atom
   trace on every decision) lets mods answer "why was my post
   removed?" with exact evidence, not guesswork.

### Time savings

Hard-to-quantify but concrete:

- Multi-clause rules collapse 2–5 separate rules into one, saving
  the cognitive overhead of cross-rule coordination.
- Adaptive shadow promotion typically activates safe rules in hours,
  not days. Risky rules get held indefinitely until human review —
  saving the cleanup time when a bad rule would otherwise go live.
- What-If Studio shows the false-positive count _before_ activation,
  saving the time spent on retrospective complaint handling.
- Briefing panel summarises an hour of moderation in one screen,
  replacing the audit-log-scrolling ritual.
- The suggestion engine surfaces rule opportunities the mod team
  hadn't articulated — converting tribal knowledge into formal
  policy.

---

## Headline capabilities

EDICT keeps the safety posture you'd expect of any responsible
moderation tool (LLM at edit time only, schema-validated output,
shadow first, rollback on every action) and adds — across
architecture, evaluation, safety, analytics, and UI — capabilities
that distinguish it:

- Multi-clause rules with combinator algebra
- Adaptive shadow promotion (confidence-based, not time-based)
- Per-rule + sub-wide circuit breakers with tiered cooldowns
- Mod-consensus workflow (off / risky / strict)
- Undo-learning loop with pattern deflection
- Event-sourced audit with time-travel queries
- What-If Studio (historical replay against fact-bag snapshots)
- Effectiveness scoring with grade letters
- Static conflict detection (overlap / contradiction / shadowing)
- Audit-mined suggestion engine
- 30+ template gallery across six categories
- Custom-post Command Center with six tabs (Rules, Effectiveness,
  Audit, Briefing, Conflicts, Suggestions)
- Per-clause decision explainability with captured fact values

---

## Technical excellence

- **Architecture**: hexagonal + event-sourcing + CQRS. Domain layer
  has zero outward dependencies. Composition root in one file.
- **Tests**: 14+ unit suites + fast-check property tests proving
  boolean algebra laws on the combinator evaluator.
- **Type safety**: every ID is a branded primitive — `RuleId`,
  `ModeratorId`, `ThingId`, `ULID` cannot be mixed up at compile
  time.
- **Determinism**: runtime evaluator is pure TS. Same fact-bag, same
  verdict, every time. What-If Studio relies on this.
- **Schema-strict structured output**: OpenAI is called with a
  JSON-Schema-constrained `response_format` _and_ re-validated
  through Zod _and_ re-checked through `ActionWhitelistPolicy`.
  Three independent gates.
- **No LLM at runtime**: every per-post evaluation is in-process,
  sub-millisecond, zero-cost.

---

## Ports & ecosystem fit

- Devvit Web app (`@devvit/web`) with Hono routes
- Devvit Blocks custom posts (`@devvit/public-api`)
- Devvit Redis for event store + projections + rollback tokens
- Devvit triggers for every Reddit lifecycle event
- Devvit scheduler for adaptive shadow sweeps, briefings,
  effectiveness recompute, compaction, rollback decay

Nothing leaves the Devvit ecosystem except a single outbound call to
`api.openai.com` at rule-edit time. Declared in
`devvit.json`'s `permissions.http.domains`.
