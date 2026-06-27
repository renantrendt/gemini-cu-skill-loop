// Skill distiller: turn a FAILED trajectory into a reusable skill note.
//
// Input  : { goal, trajectory, priorSkills }
//          trajectory entries: { step, action, intent }  (intent comes
//          straight from Gemini Computer Use)
// Output : { tag, title, note, fromIntents }
//          The `tag` is a short keyword used by skillStore to retrieve
//          this skill on future tasks (e.g. 'export', 'login', 'search').
//
// Live path: a Gemini text call summarises *what went wrong* and *how to
// avoid it next time*. No screenshots are sent; we operate on the model's
// own intents, which keeps the call cheap and PII-light.

const SYSTEM_PROMPT = `You are distilling a reusable UI skill from a failed
agent trajectory. The agent uses Gemini Computer Use to drive a browser.

INPUT you will receive:
- goal: what the user asked the agent to do
- trajectory: each step's action (click/type/scroll/...) + the agent's own
  intent string
- prior_skills (optional): notes that were already in context

OUTPUT a single JSON object, no prose:
{
  "tag":   short kebab-case keyword for the task family (e.g. "export",
           "login", "wiki-edit"). Used to retrieve the skill for similar
           future goals — pick a word that will actually appear in those
           future goals.
  "title": <=10 words. A crisp lesson, not a description of the failure.
  "note":  1-3 sentences. Concrete guidance the agent should follow next
           time. Reference UI locations, expected sequences, or pitfalls
           you can infer from the intents. NO promises about what will
           work — only durable guidance.
}

Do NOT include backticks or markdown fences. Output JSON only.`;

function buildUserPrompt({ goal, trajectory, priorSkills }) {
  const lines = [];
  lines.push(`goal: ${goal}`);
  if (priorSkills && priorSkills.length) {
    lines.push('prior_skills:');
    for (const s of priorSkills) lines.push(`  - ${s.title}: ${s.note}`);
  }
  lines.push('trajectory:');
  trajectory.forEach((t, i) => {
    const a = t.action ?? {};
    const argStr = Object.entries(a)
      .filter(([k]) => k !== 'type')
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(' ');
    lines.push(`  ${i}. ${a.type}${argStr ? ' ' + argStr : ''}  // ${t.intent ?? ''}`);
  });
  return lines.join('\n');
}

function safeParseSkillJSON(text) {
  // Tolerate stray code-fence markers if the model ignored instructions.
  const cleaned = text
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const obj = JSON.parse(cleaned);
  if (!obj.tag || !obj.title || !obj.note) {
    throw new Error('Distilled skill is missing tag/title/note');
  }
  return obj;
}

// distillerFn signature: ({ goal, trajectory, priorSkills }) -> skill object
export function createDistiller({
  apiKey = process.env.GEMINI_API_KEY,
  model = 'gemini-3.5-flash',
  modelFn = null, // for mocking; ignored if null
} = {}) {
  return async function distill({ goal, trajectory, priorSkills = [] }) {
    const fromIntents = trajectory.map((t) => t.intent ?? '');
    if (modelFn) {
      const out = await modelFn({ goal, trajectory, priorSkills });
      return { ...out, fromIntents };
    }

    if (!apiKey) {
      throw new Error(
        'Distiller needs GEMINI_API_KEY (or inject modelFn for mock).'
      );
    }
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });

    const userPrompt = buildUserPrompt({ goal, trajectory, priorSkills });

    const res = await ai.models.generateContent({
      model,
      contents: [
        { role: 'user', parts: [{ text: SYSTEM_PROMPT + '\n\n' + userPrompt }] },
      ],
      config: { responseMimeType: 'application/json' },
    });

    const text =
      res.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text ?? '';
    const parsed = safeParseSkillJSON(text);
    return { ...parsed, fromIntents };
  };
}
