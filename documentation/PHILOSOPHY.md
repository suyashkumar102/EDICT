# Philosophy

What EDICT believes, in seven principles. Every architectural choice
above is downstream of these.

---

## 1. Mods are the experts. EDICT is the typist.

EDICT does not try to be a smarter moderator than the moderators it
serves. It does not pick rules for them. It does not auto-activate
suggestions. It does not learn community norms over time and adjust.

It does one thing: it lets a mod express a rule the way they already
think about it, and runs that rule deterministically until they say
otherwise. The intelligence in the system belongs to the human; EDICT
just removes the friction of writing YAML.

When you're tempted to add "smart" behaviour — auto-tuning thresholds,
ML-suggested rule modifications, AI-driven escalation — ask "would a
veteran moderator be furious that this happened without their say?"
If yes, don't ship it.

---

## 2. Every action is reversible.

Even one-off actions. Even a ban. Even six months later, if the
moderator can prove they were within the rollback window, EDICT honours
it.

This is the contract that lets a moderator type a rule and hit
**Compile** without fear. Without reversibility, every new rule is a
poker bet; with reversibility, every new rule is a low-stakes
experiment.

Consequences:

- Rollback tokens persist for 30 days minimum (configurable, capped).
- Outgoing messages (`commentReply`, `modmailNotify`) are explicitly
  marked irreversible at the type level — moderators must opt into
  these knowing they won't get an undo.
- The undo path feeds the learning loop, not just the audit log.

---

## 3. Surprise is failure.

A rule that fires unexpectedly is a bug in EDICT, even if technically
the rule was right. A moderator who can't predict what EDICT will do
will eventually distrust it; a moderator who distrusts a tool stops
using it.

Consequences:

- Adaptive shadow exists so a rule has _observed evidence_ before it
  acts. Time-based shadow alone is theatre.
- Explainability is non-negotiable. Every action carries a full
  per-atom trace. "Why did Rule X fire?" must have a precise answer.
- Conflicts are surfaced visibly. Two rules silently fighting on the
  same post is the worst form of surprise.

---

## 4. Errors should be loud, not corrected.

A compile failure does not silently retry. A schema validation error
does not auto-coerce. An ambiguous sentence does not best-guess.

The LLM is a tool we use carefully. When it fails, the moderator sees
the failure and chooses what to do. We never paper over LLM mistakes
with `try/catch + default value` — that's how silent miscompiles
ship.

Consequences:

- Compile pipeline is fail-fast at every stage.
- Clarification is preferred over guessing.
- Errors are typed (every `DomainError` subclass has a `kind`) so
  routes can branch on intent, not on string matching.

---

## 5. The event log is the truth.

The current state in Redis is a projection. The audit log is a
projection. The leaderboard is a projection. **None of them are
authoritative.** The event log is.

If a projection disagrees with the event log, the projection is wrong
and gets rebuilt. If the event log disagrees with itself, we have a
bug — but at least it's the bug, not an aliasing of multiple slightly-
wrong states.

Consequences:

- Every state change emits an event. No exceptions.
- Projections are idempotent — re-applying an event is a no-op.
- Compaction never deletes events; it adds snapshots for fast
  hydration. The events are forever.

---

## 6. Boring beats clever.

Pure functions over reactive streams. Immutable values over OOP. A
single Redis ZSet over a custom storage engine. ESLint over manual
style review. We make boring choices on purpose because boring choices
are the ones we can maintain at 2 AM.

The one exception: the safety algorithms (adaptive shadow, undo
learning, conflict detection) are allowed to be _interesting_ — those
are the load-bearing parts of the product, and clever there is the
difference between a tool that ships and a tool that's surprised by
reality.

Everywhere else: boring.

---

## 7. The mod's time is the most expensive resource.

Not the LLM token budget. Not the Redis memory budget. Not the
developer's time. The moderator's.

A mod team that spends 4 hours fighting a bad rule has lost more value
than EDICT will ever generate. Every design choice in EDICT is
optimised for "the mod opens the app, accomplishes their goal in <60
seconds, closes the app."

Consequences:

- Defaults are aggressive: sandbox on, adaptive shadow on, consensus
  in risky-mode by default. New installs are immediately safe.
- Templates ship as drafts, never auto-activated. A mod browses, picks,
  reviews, then activates.
- The Briefing panel exists to summarise a shift's worth of action in
  one scroll. No mod should ever have to read the raw audit log to
  know what happened.
- Errors include "what to do next." Not just "what went wrong."

---

These seven principles are the only ones that should be invoked when
adding a new feature. If a feature doesn't visibly serve at least one
of them, it doesn't ship.
