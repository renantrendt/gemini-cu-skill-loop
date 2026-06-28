# wv-Apple--0 — Ceiling Exhibit (intentional, not a hidden failure)

This bundle is **kept on purpose** as the honest documentation of where
the skill loop *doesn't* help. Read alongside the win exhibit at
[../wv-ArXiv--23/](../wv-ArXiv--23/).

## What you'd expect
- `baseline.json` shows WebVoyager's official auto-eval prompt scoring the
  bare-model attempt **NOT SUCCESS**.
- `distilled-skill.json` shows a sensible, correct strategy lesson:
  *"Systematically record base configurations before expanding nested
  upgrade options."*
- `retry.json` shows the agent **following** that skill (step 9: it
  clicks Compare per the skill) — and **still failing**.
- `skills.json` is empty: the verified keep-gate refused to persist a
  skill the retry couldn't validate.

That's the system behaving exactly as designed.

## Why the loop couldn't fix this one

Apple's MacBook-Air comparison UI is the textbook "mechanics-bound"
failure mode for Computer Use agents:

1. **Custom-JS dropdowns**, not native `<select>` — open via click, then
   require a sequenced click on an option inside a re-rendering overlay.
   The agent's pixel-loop can't time the open / select reliably.
2. **Lazy-loaded prices** rendered only after the dropdown commits, so
   scrolling the comparison page before successful selection finds
   nothing to read.
3. The distilled skill operates at the **strategy level** ("use the
   comparison page") — it cannot, by text alone, teach **widget
   mechanics** ("click the dropdown caret, wait 500ms for the overlay,
   click the option's text label, wait for re-render, *then* read").

## What we learned from this bundle
- **Strategy-fixable** failures (wrong approach, fixable by a text note)
  → the loop helps. See [../wv-ArXiv--23/](../wv-ArXiv--23/).
- **Mechanics-bound** failures (custom widgets, lazy state, drag/canvas)
  → text-level distillation can't close the gap; the keep-gate correctly
  refuses to bank a non-working skill.

That distinction is the empirical contribution. This bundle documents
the negative side of it.
