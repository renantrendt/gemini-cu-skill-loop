// Outcome verifier for a Gemini Computer Use trajectory.
//
// Per-task verifier spec (tasks.js):
//   {
//     id, goal, startUrl,
//     check: {                      // deterministic checks (preferred)
//       urlContains?: string | string[],
//       urlMatches?: RegExp,
//       selectorVisible?: string,
//       selectorText?: { selector, contains },
//       custom?: async (page) => boolean,
//     },
//     judgeWith?: 'vlm' | 'text',   // fallback if deterministic check absent
//     judgePrompt?: string,
//   }
//
// Returns: async (env, trajectory) -> boolean
//
// Deterministic is always tried first. VLM judge is the fallback for tasks
// where the goal-state isn't easily expressed as a DOM/URL predicate.

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

async function deterministicPass(env, check) {
  if (!check) return null; // signal "no deterministic check"
  const page = env.page;
  const url = env.currentUrl ? env.currentUrl() : page?.url();

  for (const needle of asArray(check.urlContains)) {
    if (!url || !url.includes(needle)) return false;
  }
  if (check.urlMatches && !check.urlMatches.test(url ?? '')) return false;
  if (check.selectorVisible) {
    try {
      const visible = await page
        .locator(check.selectorVisible)
        .first()
        .isVisible({ timeout: 2000 });
      if (!visible) return false;
    } catch {
      return false;
    }
  }
  if (check.selectorText) {
    try {
      const txt = await page
        .locator(check.selectorText.selector)
        .first()
        .innerText({ timeout: 2000 });
      if (!txt?.toLowerCase().includes(check.selectorText.contains.toLowerCase()))
        return false;
    } catch {
      return false;
    }
  }
  if (check.custom) {
    const ok = await check.custom(page);
    if (!ok) return false;
  }
  // If `check` only carries fields we didn't recognise, treat as "no signal".
  const known = ['urlContains', 'urlMatches', 'selectorVisible', 'selectorText', 'custom'];
  const hadAny = known.some((k) => check[k] != null);
  return hadAny ? true : null;
}

const VLM_JUDGE_PROMPT = `You are a strict outcome verifier for a browser
agent. You will be given:
- the task goal
- the final screenshot

Did the agent ACTUALLY accomplish the goal? Answer with a single JSON
object: {"passed": true|false, "reason": "<one sentence>"}. Be strict —
"looks close" is not "passed". Output JSON only, no markdown.`;

async function vlmJudge({ apiKey, model, goal, screenshotB64, judgePrompt }) {
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });
  const res = await ai.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          { text: (judgePrompt ?? VLM_JUDGE_PROMPT) + '\n\ngoal: ' + goal },
          { inlineData: { mimeType: 'image/png', data: screenshotB64 } },
        ],
      },
    ],
    config: { responseMimeType: 'application/json' },
  });
  const text =
    res.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text ?? '';
  try {
    const obj = JSON.parse(text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim());
    return !!obj.passed;
  } catch {
    return false;
  }
}

export function createVerifier({
  task,
  apiKey = process.env.GEMINI_API_KEY,
  judgeModel = 'gemini-3.5-flash',
} = {}) {
  return async function verify(env /*, trajectory */) {
    const det = await deterministicPass(env, task.check);
    if (det !== null) return det;

    if (task.judgeWith && task.judgeWith !== 'none') {
      if (!apiKey) {
        throw new Error(
          `Task ${task.id}: needs VLM judge but GEMINI_API_KEY missing.`
        );
      }
      const screenshotB64 = await env.screenshot();
      return await vlmJudge({
        apiKey,
        model: judgeModel,
        goal: task.goal,
        screenshotB64,
        judgePrompt: task.judgePrompt,
      });
    }
    return false;
  };
}
