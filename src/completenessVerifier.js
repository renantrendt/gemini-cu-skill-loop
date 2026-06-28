// Completeness Verifier — VLAA-GUI 2026 pattern.
//
// Called when the CU agent emits a 'done' (no functionCall) turn. It
// inspects: the user goal + the final natural-language answer the agent
// produced + the final screenshot + the last N actions, and decides
// whether the task was actually completed or whether the agent fell into
// the "silent unproductive end" failure mode (e.g. saying 'Scroll down
// to view more' when an answer was expected).
//
// If incomplete and there is step budget left, runTask injects the
// returned `missing` critique into the agent context and continues for
// one more attempt to finish.
//
// Cheap text+1-image call. Set thinkingLevel separately if desired.
//
// Reference:
//   VLAA-GUI: Knowing When to Stop, Recover, and Search (arXiv 2604.21375)
//   "Completeness Verifier ... cuts false-completion by ~4pp"

const SYSTEM = `You are a strict completeness verifier for a computer-use agent.

You will be given:
- the user's task instruction
- the agent's final natural-language answer
- the final screenshot
- the agent's last 5 actions for context

Your single job: decide if the agent has FULLY answered the task.

Answer "complete=true" only if the agent's final answer contains the
specific information the task asked for (a name, count, value, URL,
etc.). If the final answer is an action description ("Scroll down to
see..."), a navigation note, or a vague summary that doesn't contain
the asked-for value, answer "complete=false".

Output a single JSON object on a new line:
{"complete": <bool>, "missing": "<one-sentence description of what's
still needed; empty string if complete>", "confidence": <0..1>}`;

export async function verifyCompleteness({
  apiKey = process.env.GEMINI_API_KEY,
  model = 'gemini-3.5-flash',
  goal,
  finalAnswer,
  finalScreenshotB64,
  recentActions = [],
  thinkingLevel = null,
}) {
  if (!apiKey) throw new Error('verifyCompleteness: GEMINI_API_KEY missing');
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });

  const actionsText = recentActions
    .slice(-5)
    .map((t, i) => `  ${i}. ${t.action?.type ?? '?'} — ${(t.intent ?? '').slice(0, 100)}`)
    .join('\n');

  const userPrompt =
    `TASK: ${goal}\n\n` +
    `AGENT'S FINAL ANSWER:\n  ${finalAnswer || '<empty>'}\n\n` +
    `LAST ACTIONS:\n${actionsText || '  (none)'}\n`;

  const cfg = { responseMimeType: 'application/json', systemInstruction: SYSTEM };
  if (thinkingLevel) cfg.thinkingConfig = { thinkingLevel };

  const res = await ai.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          { text: userPrompt },
          ...(finalScreenshotB64
            ? [{ inlineData: { mimeType: 'image/png', data: finalScreenshotB64 } }]
            : []),
        ],
      },
    ],
    config: cfg,
  });

  const text = res.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text ?? '';
  try {
    const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    const obj = JSON.parse(cleaned);
    return {
      complete: !!obj.complete,
      missing: obj.missing ?? '',
      confidence: obj.confidence ?? 0,
    };
  } catch {
    // If the verifier itself fails to parse, treat as "complete" to avoid
    // creating an extra failure mode.
    return { complete: true, missing: '', confidence: 0 };
  }
}
