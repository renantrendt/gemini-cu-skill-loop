// Pre-Operative Critic — Voyager/GUI-Critic-R1 lineage.
//
// Runs BEFORE a high-risk action is executed. Looks at the agent's
// proposed action + recent context + current screenshot and outputs a
// verdict: allow / block / correct.
//
// Gated by `isHighRisk` — we never want a critic in the hot path on
// every step. Reference:
//   GUI-Critic-R1 (arXiv 2506.04614) — pre-operative critic
//   OS-Kairos (arXiv 2503.16465) — confidence-gated intervention

const RISK_PATTERNS = [
  /\bdelete\b/i,
  /\bremove\b/i,
  /\bunsubscribe\b/i,
  /\bsubmit\b/i,
  /\bsend\b/i,
  /\bbuy\b/i,
  /\bpay\b/i,
  /\bcheckout\b/i,
  /\bsign\s*in\b/i,
  /\blog\s*in\b/i,
];

export function isHighRisk(action) {
  if (!action) return false;
  // Type-based risk: irreversible by nature
  if (['drag_and_drop'].includes(action.type)) return true;
  // Args-based risk: text fields and URLs that hint at side effects
  const haystack = JSON.stringify(action).toLowerCase();
  return RISK_PATTERNS.some((re) => re.test(haystack));
}

const SYSTEM = `You are a pre-operative critic for a computer-use agent.
You see the agent's proposed action BEFORE it executes. Decide:
- allow: action is safe & on-task
- block: action is unsafe / off-task / will lose progress
- correct: action is close but should be slightly different — propose
  a corrected action in the same vocab

Output a single JSON object:
{"verdict": "allow"|"block"|"correct", "reason": "<one sentence>",
 "suggested_action": <action object or null>}`;

export async function preOperativeCritic({
  apiKey = process.env.GEMINI_API_KEY,
  model = 'gemini-3.5-flash',
  goal,
  proposedAction,
  recentActions = [],
  screenshotB64 = null,
}) {
  if (!apiKey) throw new Error('preOperativeCritic: GEMINI_API_KEY missing');
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });

  const userPrompt =
    `TASK: ${goal}\n` +
    `PROPOSED ACTION: ${JSON.stringify(proposedAction)}\n` +
    `RECENT ACTIONS:\n${recentActions.slice(-3).map((t, i) => `  ${i}. ${t.action?.type ?? '?'} — ${(t.intent ?? '').slice(0, 100)}`).join('\n') || '  (none)'}\n`;

  const res = await ai.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          { text: userPrompt },
          ...(screenshotB64
            ? [{ inlineData: { mimeType: 'image/png', data: screenshotB64 } }]
            : []),
        ],
      },
    ],
    config: { systemInstruction: SYSTEM, responseMimeType: 'application/json' },
  });

  const text = res.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text ?? '';
  try {
    const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    const obj = JSON.parse(cleaned);
    return {
      verdict: obj.verdict ?? 'allow',
      reason: obj.reason ?? '',
      suggestedAction: obj.suggested_action ?? obj.suggestedAction ?? null,
    };
  } catch {
    return { verdict: 'allow', reason: 'critic failed to parse', suggestedAction: null };
  }
}
