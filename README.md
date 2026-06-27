# gemini-cu-skill-loop

> An open-source skill-loop adapter for **Gemini 3.5 Flash Computer Use**:
> the agent learns reusable skills from its own failures, verified, with
> no fine-tuning.

A computer-use agent attempts a browser task; when it fails, the loop
distills a reusable **skill** from the failed trajectory (using the
per-step `intent` the Computer Use API returns), retries, and **keeps the
skill only if a verified retry passes**. Over time the agent improves on
the task families it has seen — without any weight training.

## How it works

1. The agent runs a task via Gemini 3.5 Flash Computer Use
   (screenshot → action + intent → execute, looped via the SDK's
   multi-turn `functionResponse`).
2. An outcome verifier checks whether the task actually succeeded
   (deterministic URL/DOM checks first, VLM judge fallback).
3. On failure, a distiller summarises the failed trajectory's intents
   into a small skill note.
4. The agent retries with the skill in context; the skill is persisted
   **only if** the retry verifiably passes — a net-positive keep-gate.
5. Saved skills are retrieved by `tag` for matching future tasks, and
   their generalisation is checked against a held-out variant of the
   same task family.

## Layout

```
src/
  geminiCua.js      Computer Use adapter. Owns the multi-turn loop:
                    screenshot → functionCall {name,args,intent} →
                    execute → functionResponse with next screenshot.
                    Coords 0..999 → denormalised to pixel coords.
  playwrightEnv.js  Browser env (screenshot / execute / size / reset).
                    Maps the documented action vocab to Playwright.
  distiller.js      Failed trajectory + intents → {tag, title, note}.
  verifier.js       Deterministic checks (URL/DOM) with VLM-judge fallback.
  skillLoop.js      Baseline → fail → distill → verified-retry → keep.
  skillStore.js     In-memory or JSON-backed skill library.
  tasks.js          Curated browser tasks + held-out variants per family.
demo/
  mockRun.js        End-to-end loop with NO API key (mock model + UI).
  liveRun.js        Real browser + real Gemini call. Needs GEMINI_API_KEY.
test/
  smoke.js          Offline smoke tests for everything not gated on a key.
```

## Prior art & how this differs

Failure-driven skill learning is an established pattern; this project's
contribution is a specific combination:

- **EvoSkill** (arXiv 2603.02766) — failure → skill, for coding agents
  (no GUI).
- **CUA-Skill** (Microsoft, arXiv 2601.21123) — GUI/desktop skills with
  failure recovery, but skills are engineered and retrieved from a
  pre-built library rather than learned from the agent's own failures;
  Windows-specific.
- **SkillRL** (arXiv 2602.08234) — failure → lessons + skill library,
  trained via reinforcement learning on embodied/web domains.

This project is a **training-free, open-source loop that learns skills
from the agent's own failures (with a verified keep-gate), wired to the
Gemini 3.5 Flash Computer Use API.**

## Quick start (no API key)

```bash
npm install
npm run demo        # mock model + mock UI; proves the loop control flow
npm test            # offline smoke tests for every module
```

The mock demo prints: baseline fails → a skill is distilled → the verified
retry passes → the skill is kept.

## Live run (Gemini 3.5 Flash Computer Use + real browser)

```bash
npm install
npx playwright install chromium     # one-time
export GEMINI_API_KEY=...           # https://aistudio.google.com/api-keys
npm run demo:live                   # runs all primary tasks
npm run demo:live wiki-edit-tab     # run a single task
HEADLESS=1 npm run demo:live        # headless mode
```

Each task runs baseline → on failure, distill → verified retry → on pass,
persist + run the held-out variant of the same family.

## Caveats (honest)

- Gemini 3.5 Flash Computer Use is in **public preview**. The SDK call is
  wired against the documented shape
  (`tools: [{ computerUse: { environment: 'ENVIRONMENT_BROWSER' } }]`,
  multi-turn `functionResponse` with `inlineData` PNGs, coords 0..999),
  but verify against Google's reference impl before relying on it.
- Skill lift on top of a strong base model is **modest**. Demo on a task
  family with real headroom; verify on **held-out** instances or it's
  just a lookup table.
- Live CU demos can be flaky on dynamic UIs/pop-ups — pick stable target
  sites and record a fallback video.

## Optional: opt-in dataset

You can opt in to export verified (failure → fix) trajectories as an open
dataset. Trajectories include screenshots (potential PII); export is
consent-gated and redacted. Not sent to any provider for training.

## License

MIT — see `LICENSE`.
