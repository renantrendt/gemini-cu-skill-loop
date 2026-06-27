# gemini-cu-skill-loop

> An open-source skill-loop adapter for Gemini 3.5 Flash Computer Use: the agent
> learns reusable skills from its own failures, verified, with no fine-tuning.

A computer-use agent attempts a task; when it fails, the loop distills a reusable
**skill** from the failed trajectory (using the per-step `intent` the Computer Use API
returns), retries, and **keeps the skill only if a verified retry passes**. Over time the
agent improves on the task families it has seen — without any weight training.

## How it works

1. The agent runs a task via Gemini 3.5 Flash Computer Use (screenshot → action + intent → execute).
2. An outcome verifier checks whether the task actually succeeded.
3. On failure, a distiller turns the failed trajectory into a candidate skill.
4. The agent retries with the skill in context; the skill is saved **only if** the retry
   verifiably passes (a net-positive keep-gate).
5. Saved skills are retrieved for matching future tasks.

## Prior art & how this differs

Failure-driven skill learning is an established pattern; the contribution here is a
specific combination:

- **EvoSkill** — failure → skill, for coding agents (no GUI).
- **CUA-Skill** (Microsoft) — GUI/desktop skills with failure recovery, but skills are
  engineered and retrieved from a pre-built library rather than learned from the agent's
  own failures; Windows-specific.
- **SkillRL** — failure → lessons + skill library, but trained via reinforcement learning
  on embodied/web domains.

This project is a **training-free, open-source loop that learns skills from the agent's own
failures (with a verified keep-gate), wired to the Gemini 3.5 Flash Computer Use API.**
Implemented here: the Computer Use adapter, the skill distiller, the verified keep-gate,
and the skill store. The ideas above are credited.

## Layout

- `src/geminiCua.js` — Computer Use adapter (screenshot → `{action, intent}` → execute).
  Contract: `tools=[{type:'computer_use',environment:'browser'}]`, coordinates 0–1000.
- `src/skillLoop.js` — fail → distill → verified retry → keep-or-discard.
- `src/skillStore.js` — the learned-skill library.
- `demo/mockRun.js` — runs the full control flow with no API key (mock model + mock UI).

## Quick start (no API key)

```bash
node demo/mockRun.js
```

Prints: baseline fails → a skill is distilled → the verified retry passes → the skill is kept.

## Run with a live agent

1. `npm install` (`@google/genai`, `playwright`)
2. `export GEMINI_API_KEY=...`
3. Implement the live call in `geminiCua.proposeAction` (marked `REAL CALL`) and replace
   the mock environment with a Playwright browser.

## Optional: opt-in open dataset

You can opt in to export verified (failure → fix) trajectories as an open dataset for the
community. This is not sent to any provider for training. Trajectories include screenshots
(potential PII), so export is consent-gated and redacted.

## License

MIT — see `LICENSE`.
