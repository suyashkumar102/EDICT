# EDICT — Demo Video Script (under 60 seconds)

---

## Pre-recording setup

Have these ready before you hit record:

- Subreddit open in one tab
- Terminal with `npm run dev` running (logs visible)
- Rule text copied to clipboard:
  `Lock any post whose title is entirely in capital letters, unless the post body is longer than 100 characters.`
- Title copied: `All-caps title lock`

---

## Shot 1 — Compose (0:00–0:14)

**Action:** Subreddit menu (three dots) → EDICT - Compose new rule

**Paste into the rule field:**

```
Lock any post whose title is entirely in capital letters,
unless the post body is longer than 100 characters.
```

**Paste into title:** `All-caps title lock`

**Hit:** Compile + What-If

**Voiceover:**

> "AutoModerator needs YAML. EDICT takes plain English — including multi-clause logic with exceptions that single-sentence tools cannot express."

**Wait for toast:** `Rule compiled. Open Command Center to preview + activate.`

---

## Shot 2 — Activate (0:14–0:18)

**Action:** Subreddit menu → EDICT - Activate LIVE

**Toast appears:** `Activated "All-caps title lock" in LIVE phase.`

**Voiceover:**

> "Activated."

---

## Shot 3 — Rule fires (0:18–0:32)

**Action:** Create a new post. Title: `THIS IS SHOUTING` — body empty.

**Switch to terminal. Show logs:**

```
[edict] evaluate: outcome verdict =
  matchedClauseName: "all-caps-title"
  verdict: { kind: "lock" }
  atom[ALLCAPS01] titleAllCaps=true cmp=isTrue => MATCH
  result: FIRED
```

**Voiceover:**

> "Post submitted. EDICT evaluates it in milliseconds — pure TypeScript, zero AI cost per post. Every decision shows the exact atoms that matched."

---

## Shot 4 — UNLESS fires (0:32–0:40)

**Action:** Create another post. Title: `THIS IS SHOUTING` — body: paste 150 characters of text.

**Terminal shows:** `result: NOT FIRED — UNLESS matched`

**Voiceover:**

> "Now with a long body — the UNLESS clause fires. The rule doesn't act. That's multi-clause logic working live."

---

## Shot 5 — Explain + Reverse (0:40–0:52)

**Action:** On the locked post → three dots → EDICT - Explain this decision

**Dialog opens showing:**

```
Full evaluation trace:
clause: all-caps-title
  atom[ALLCAPS01] titleAllCaps=true => MATCH
  result: FIRED

Fact values: titleAllCaps: true, postLengthChars: 0
```

**Voiceover:**

> "Every decision is explained atom-by-atom."

**Action:** → EDICT - Reverse this decision → hit Reverse decision

**Toast:** `Decision reversed: lock undone on this item.`

**Voiceover:**

> "Every action is reversible. One click."

---

## Shot 6 — Command Center (0:52–0:58)

**Action:** Subreddit menu → EDICT - Open Command Center

**Dialog shows:**

```
🟢 Live
• All-caps title lock  (1 matches · 100% eff)
• Short post filter    (3 matches · 100% eff)
```

**Voiceover:**

> "Live match counts, effectiveness scores, pause or delete any rule — all from the mod menu."

---

## Shot 7 — End card (0:58–1:00)

**Screen:** Static text overlay

```
EDICT
Plain English → Deterministic Rules
Multi-clause · Adaptive shadow · 30-day undo
AI never reads your posts.
```

---

## Recording notes

- Keep cursor movements slow and deliberate — fast mouse movement looks nervous on video
- The compile step takes 2–4 seconds (Gemini API call) — do not cut it, it shows the AI working
- Split screen for Shot 3: Reddit on left, terminal on right — this is the frame judges will screenshot
- Total clicks: compose → activate → post `THIS IS SHOUTING` → post with body → explain → reverse → command center
- If you need to cut for time, drop Shot 4 (the UNLESS demo) — it is impressive but not essential
