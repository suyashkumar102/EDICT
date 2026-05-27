# Install & launch

How to take this repo from clone to a published Devvit app.

---

## Prerequisites

- Node.js ≥ 22.2 (`.nvmrc` pins the exact version)
- A Reddit account that can install Devvit apps (any account, but you'll
  need mod permissions on a sub for playtest)
- An OpenAI API key (any tier — gpt-5.4-mini calls are cheap)

---

## Local setup

```bash
git clone <repo-url> edict
cd edict
npm install
cp .env.example .env
# Fill OPENAI_API_KEY in .env if you want to run the local compile smoketest
```

Sanity check:

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # eslint, 0 warnings allowed
npm run verify        # vitest run (unit + property tests)
```

If `verify` passes, you have a working install.

---

## Devvit account setup

```bash
# Once per machine
npx devvit login
```

This opens a browser to authenticate with Reddit and stores credentials
in `~/.devvit/`.

---

## First upload

```bash
npm run build         # tsc + vite → distribution/server/Bootstrap.cjs + distribution/customposts/Index.js
npx devvit upload     # uploads as a private app
```

The first upload creates the app in the Reddit Developer Console.
Subsequent uploads update it.

---

## Set the OpenAI API key

EDICT reads the OpenAI key from a Devvit _global_ setting (encrypted,
only the app developer can read). After the first upload:

```bash
npx devvit settings set openaiApiKey
# prompt: paste your sk-...
```

This is the only credential the app needs.

---

## Install on a playtest subreddit

```bash
npx devvit install r/EDICTplayground
```

Replace `EDICTplayground` with any subreddit you moderate. The app
shows up in the subreddit's installed apps list immediately.

---

## Configure per-subreddit settings

In Reddit, go to your subreddit's mod tools → installed apps → EDICT →
Settings. Adjust:

- `sandboxMode` — **leave on** for the first few days. EDICT will log
  decisions to the event store but take no action.
- `adaptiveShadow` — leave on
- Other settings — defaults are fine

When you're ready to let EDICT act, switch `sandboxMode` off.

---

## Compose your first rule

In the subreddit:

1. Open the kebab menu → **EDICT · Compose new rule**
2. Type something like: _"Send to mod queue any post under 50
   characters from accounts less than 7 days old."_
3. Hit **Compile + What-If**
4. EDICT replies with a toast: _"Rule compiled. Open Command Center to
   preview + activate."_
5. Open **EDICT · Open Command Center**, find the new rule, click
   **Activate**.
6. The rule enters adaptive shadow. Wait for the auto-promotion, or
   watch the **Briefing** panel for hourly progress.

---

## Playtest

```bash
npm run dev    # = devvit playtest
```

Playtest mode mounts the app live and tails its logs. Trigger events
by posting/commenting in the playtest sub. Every trigger event prints
to your terminal.

To tail production logs:

```bash
npx devvit logs
```

---

## Publish

When you're satisfied:

```bash
npx devvit publish           # public-listing review (recommended)
npx devvit publish --public  # skip review for faster turnaround
```

A reviewed publish goes through Reddit's app-directory listing process.
A `--public` publish is immediately installable by anyone who has the
direct URL.

---

## Pre-deploy preflight

```bash
npm run preflight
```

Checks:

- `devvit.json` integrity (every menu endpoint has a route handler)
- Fetch domains in `devvit.json` match what `OpenAiLLMClient` calls
- Required permissions are declared
- All `seeds/Index.ts` slugs resolve to a `TemplateGallery.get` entry

A failed preflight blocks the publish step.

---

## Smoketests

```bash
npm run compile:smoketest
```

Runs the compiler against 6 canonical English inputs using the real
OpenAI API. Asserts the output parses through the Zod schema and
matches the expected shape. Useful before a model-version bump.

```bash
npm run replay
```

Reads a local fixture event log (from `tests/fixtures/sample.events.json`)
and replays it through the projection + evaluator pipeline. Useful for
testing changes to the evaluator without a Devvit runtime.

---

## Troubleshooting

| Symptom                                          | Cause                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `Cannot find module '@compilation/...'`          | Run `npm install` — the path aliases are set up via tsconfig and `vite.config.ts`          |
| `OpenAI returned 401`                            | The global `openaiApiKey` isn't set. `npx devvit settings set openaiApiKey`                |
| `EBADPLATFORM` on `npm ci`                       | Use `npm install` instead — `npm ci` doesn't tolerate esbuild's optional native deps       |
| Custom-post doesn't render                       | Verify `distribution/customposts/Index.js` exists after build. If missing, `npm run build` |
| Rule compiles but no actions fire                | Check `sandboxMode` setting — defaults to ON. Also verify the rule is past shadow phase    |
| "Circuit breaker open" toast on every activation | Some other rule has been firing too hot. Inspect the **Audit** panel's "safety" category   |

---

## Uninstall

```bash
npx devvit uninstall r/<your-sub>
```

This removes the app from the subreddit. The app's Redis state for
that sub is dropped automatically by Devvit.
