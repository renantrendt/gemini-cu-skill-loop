# gemini-cu-skill-loop

> An open-source, failure-driven **skill-learning loop** on top of Gemini Computer Use:
> the agent learns reusable skills from its own failures, verified, with no fine-tuning.

A computer-use agent attempts a task; when it fails, the loop distills a reusable **skill**
from the failed trajectory (using the per-step `intent` Gemini Computer Use returns), retries,
and **keeps the skill only if a verified retry passes**. Over time the agent improves on the
task families it has seen — without any weight training.

## How it works

1. The agent runs a task via Gemini Computer Use (screenshot → action + intent → execute).
2. An outcome verifier checks whether the task actually succeeded.
3. On failure, a distiller turns the failed trajectory into a candidate skill.
4. The agent retries with the skill in context; the skill is saved **only if** the retry
   verifiably passes (a net-positive keep-gate).
5. Saved skills are retrieved for matching future tasks.

## How it relates to prior work

Failure-driven skill learning is an established pattern, and **driving the screen is Google's
own Computer Use loop** (e.g. `google-gemini/computer-use-preview`) — that part is not the
contribution. What this project adds is the *combination*: a **training-free** loop that learns
skills from the agent's **own failures**, with a **verified keep-gate**, in the **visual
computer-use** setting. Related projects each cover a subset:

| | learns from own failures | verified keep-gate | training-free | visual / GUI | Gemini Computer Use |
|---|:--:|:--:|:--:|:--:|:--:|
| [EvoSkill](https://github.com/sentient-agi/EvoSkill) | ✅ | ✅ | ✅ | ❌ (coding) | ❌ |
| [CUA-Skill](https://github.com/microsoft/cua_skill) | ❌ (curated) | ~ (recovery) | ✅ | ✅ | ❌ (Windows) |
| [SkillRL](https://github.com/aiming-lab/SkillRL) | ✅ | ~ | ❌ (RL) | ❌ (embodied/web) | ❌ |
| [VLAA-GUI](https://github.com/UCSC-VLAA/VLAA-GUI) | ❌ (recovery) | ✅ | ✅ | ✅ | ❌ (planner only) |
| **this project** | ✅ | ✅ | ✅ | ✅ | ✅ |

(`~` = partial.) Implemented here: the skill distiller, the verified keep-gate, and the skill
store. The underlying Computer Use loop and the ideas above are credited.

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
3. Confirm the Computer-Use-capable model id — it's a preview in flux (currently
   `gemini-3-flash-preview`; `gemini-3.5-flash` may not expose Computer Use yet).
4. Implement the live call in `geminiCua.proposeAction` (marked `REAL CALL`) — the simplest
   path is to adapt Google's reference loop (`google-gemini/computer-use-preview`, Playwright)
   and replace the mock environment with its browser env.

## Optional: opt-in open dataset

You can opt in to export verified (failure → fix) trajectories as an open dataset for the
community. This is not sent to any provider for training. Trajectories include screenshots
(potential PII), so export is consent-gated and redacted.

## License

MIT — see `LICENSE`.
