# EDICT — what we deliberately didn't ship (and why)

A "hard locks" list. Everything below is either out of scope for v1.0
or actively rejected on principle. New contributors should read this
before opening a PR that adds anything on it — we will close those PRs.

This is the counterpart to `PHILOSOPHY.md`: that file says what EDICT
is _for_, this one says what it _isn't_.

---

## Deploy-time TODOs (do not merge to a tag without these)

These are placeholders the author must replace before
`devvit publish --public`:

- [ ] **GitHub Pages URLs in `edict.config.json`** &mdash; replace
      `<github-owner>` in `legal.tosUrl` and `legal.privacyUrl` with
      the actual GitHub org/user, push `docs/legal/{tos,privacy}.html`,
      enable GitHub Pages on the `docs/` folder. Verify the URLs return
      200 before publishing.
- [ ] **CI badge in `README.md`** &mdash; same `<github-owner>`
      placeholder. Replace once the repo is pushed and the `ci.yml`
      workflow has a successful run.
- [ ] **Marketing icon** &mdash; `assets/Logomark.png` is the placeholder
      icon; replace before public publish if a better logo exists.

These are tracked here (not in code TODOs) because they're release-gate
items, not engineering debt.

---

## Hard locks &mdash; never ship

### 1. Removing the kill switch default ON

`subreddit.sandboxMode` defaults to `true` in `devvit.json`. New
installs do **not** take actions until a moderator explicitly toggles
it off. This default cost us nothing and prevents any "install =
immediate moderation surprise" scenario. Do not flip the default.

### 2. Calling the LLM at evaluation time

The compiler runs once, at rule-edit time, on the moderator's
sentence. Live evaluation is pure TypeScript against the fact-bag
&mdash; no network, no model, no surprise latency. We will not add an
"LLM-assisted evaluator" mode even if it would make some rules easier
to express. The deterministic evaluator is the trust contract.

### 3. Sending post / comment bodies to OpenAI

The compiler only ever sees: the moderator's English sentence, our
schema, and a handful of fixed exemplars. Adding "let the LLM look at
the actual post" turns EDICT into a content-classification service,
which has different privacy + cost + compliance properties than what
we shipped. The fact-bag boundary is load-bearing.

### 4. Adding a non-approved AI provider

Reddit's Devvit AI provider policy (PR #96) maintains a vetted list of
providers an app is allowed to call from `http.permissions.domains`.
EDICT ships with two of them wired:

- **OpenAI** &mdash; `api.openai.com`, models `gpt-5.4 / gpt-5.4-mini /
gpt-5.4-nano`, recommended for best schema fidelity.
- **Gemini** &mdash; `generativelanguage.googleapis.com`, models
  `gemini-2.5-pro / gemini-2.5-flash / gemini-2.5-flash-lite`, free-tier
  eligible (good for the cost-conscious mod).

The moderator picks one via the `compilerProvider` setting at install
time. Adding a _third_ provider (Anthropic, Mistral, etc.) is a hard
no until it lands on the PR-#96 list &mdash; `tooling/Doctor.ts` enforces
this with a regression-guard that fails the gate if "anthropic" reappears
anywhere in the source tree.

The LLM adapter is typed behind an `LLMPort`, so if the approved list
expands, wiring a third provider is a one-file change &mdash; but until
then, this is a binary toggle, not an open extension point.

### 5. Distributive boolean-algebra normalization

`CombinatorAlgebra.normalize` collapses `not(not(x)) → x` and flattens
same-kind nesting. It does **not** apply distributive laws
(`and(a, or(b, c)) → or(and(a, b), and(a, c))`). The conflict detector
that consumes normalized trees doesn't benefit from the expansion,
and on a 10-child AND/OR the expansion explodes tree size. Locked.

### 6. Risky verdicts in the default opt-in set

`remove`, `mute`, `ban*`, `contributorAdd`, `contributorRemove` are
gated behind explicit per-rule opt-in at compile time. The compiler
will not emit them otherwise. No "convenience flag" to opt everything
in &mdash; the friction is the feature.

### 7. Mid-window TTL extensions for rollback tokens

Rollback tokens expire after `rollbackWindowDays` (default 30). A
moderator cannot extend an existing token's TTL. If a decision was
made > 30 days ago, the original action is no longer reversible
through EDICT &mdash; do it manually. The bounded window is what makes
the storage cost predictable.

### 8. Pushing past Reddit's Devvit Redis quota

Devvit Redis is 500 MB per installation. The audit timeline is capped
at 5,000 entries per sub, the briefing feed at 50 entries, and
event-store compaction runs nightly. We will not add features that
require unbounded per-sub storage. If a future feature needs more,
it ships with its own compaction story or it does not ship.

---

## Soft cuts &mdash; deliberately deferred

These could plausibly ship in a later version but are not v1.0:

- **Image / OCR content checks.** Pure-JS perceptual hashing or OCR
  inside Devvit's 30s handler window is unproven at scale. We could
  do it via the official `media` API + a background job, but that
  changes the evaluator's "no fetch" contract; needs design.
- **Internationalisation of rule sentences.** The compiler exemplars
  and system prompt are English-only. Adding multilingual support
  needs per-locale exemplars + tested fixtures; deferred.
- **Cross-subreddit rule sharing.** Devvit Redis is per-install, so
  sharing a rule today means exporting JSON and re-importing
  elsewhere. A "gallery as installable" flow would be nice; not
  required for v1.0.
- **Mobile-first Command Center layout.** Custom posts render in
  both web and mobile, but the 8-panel grid is web-first. Mobile
  works (single-column collapse) but isn't polished.
- **Per-rule LLM model override.** Mods choose one model installation-
  wide, not per rule. Adding per-rule overrides is straightforward but
  multiplies the surface area without solving an actual user pain.
- **Email digests of briefings.** The hourly briefing custom post is
  the canonical surface. Email is out of scope (Devvit doesn't have an
  outbound-email primitive anyway).

---

## Anti-patterns we caught and rolled back

Things that almost shipped, until we caught ourselves:

- **Auto-importing the template gallery on install.** The 30 curated
  templates would have been activated automatically &mdash; tempting,
  but it would have been a surprise-moderation event for the
  installing mod. They now exist as drafts only; the mod imports them
  on demand.
- **`devvit publish --public` from a pre-commit hook.** We had this in
  an earlier branch as a "ship it" convenience. Removed: publishing
  is a deliberate, dated action and never runs from a developer's
  laptop unintentionally.
- **Anthropic as a third AI provider.** Briefly added during a refactor
  for "vendor differentiation" reasons; reverted once we re-read the
  Devvit AI provider policy. Anthropic is not on PR-#96's approved list,
  unlike OpenAI and Gemini which are both wired and live. See hard lock
  #4 and `tooling/Doctor.ts` for the regression-guard.
