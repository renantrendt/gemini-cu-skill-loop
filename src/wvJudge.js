// WebVoyager auto-evaluator, faithfully ported.
//
// Prompt text below is byte-for-byte from the official upstream:
//   https://github.com/MinorJerry/WebVoyager/blob/main/evaluation/auto_eval.py
// The upstream judge calls GPT-4V; we call Gemini with the same prompt and
// the same inputs (task instruction, agent's final answer text, last N
// screenshots). The evaluator is the prompt, not the judge model — using a
// non-GPT-4V backbone is a documented variant in the WebVoyager community.

const SYSTEM_PROMPT = `As an evaluator, you will be presented with three primary components to assist you in your role:

1. Web Task Instruction: This is a clear and specific directive provided in natural language, detailing the online activity to be carried out. These requirements may include conducting searches, verifying information, comparing prices, checking availability, or any other action relevant to the specified web service (such as Amazon, Apple, ArXiv, BBC News, Booking etc).

2. Result Screenshots: This is a visual representation of the screen showing the result or intermediate state of performing a web task. It serves as visual proof of the actions taken in response to the instruction.

3. Result Response: This is a textual response obtained after the execution of the web task. It serves as textual result in response to the instruction.

-- You DO NOT NEED to interact with web pages or perform actions such as booking flights or conducting searches on websites.
-- You SHOULD NOT make assumptions based on information not presented in the screenshot when comparing it to the instructions.
-- Your primary responsibility is to conduct a thorough assessment of the web task instruction against the outcome depicted in the screenshot and in the response, evaluating whether the actions taken align with the given instructions.
-- NOTE that the instruction may involve more than one task, for example, locating the garage and summarizing the review. Failing to complete either task, such as not providing a summary, should be considered unsuccessful.
-- NOTE that the screenshot is authentic, but the response provided by LLM is generated at the end of web browsing, and there may be discrepancies between the text and the screenshots.
-- Note the difference: 1) Result response may contradict the screenshot, then the content of the screenshot prevails, 2) The content in the Result response is not mentioned on the screenshot, choose to believe the content.

You should elaborate on how you arrived at your final evaluation and then provide a definitive verdict on whether the task has been successfully accomplished, either as 'SUCCESS' or 'NOT SUCCESS'.`;

// USER_PROMPT in upstream is:
//   "TASK: <task>\nResult Response: <answer>\n<num> screenshots at the end: "
// We render it directly with substitutions.
function renderUserPrompt({ task, answer, numScreenshots }) {
  return `TASK: ${task}\nResult Response: ${answer}\n${numScreenshots} screenshots at the end: `;
}

// Strict verdict parser. The judge is supposed to end with 'SUCCESS' or
// 'NOT SUCCESS'; we look for the latter first so the substring 'SUCCESS'
// inside 'NOT SUCCESS' doesn't false-positive us.
function parseVerdict(text) {
  const upper = text.toUpperCase();
  // Find the LAST occurrence — the judge is told to deliver a final verdict.
  const notIdx = upper.lastIndexOf('NOT SUCCESS');
  const okIdx = upper.lastIndexOf('SUCCESS');
  if (notIdx !== -1 && (okIdx === -1 || notIdx >= okIdx - 4)) return false;
  if (okIdx !== -1) return true;
  return null; // unparseable -> caller decides
}

export async function wvJudge({
  apiKey = process.env.GEMINI_API_KEY,
  model = 'gemini-3.5-flash',
  task,
  answer,
  screenshotsB64 = [], // base64-encoded PNGs, ordered oldest-first
}) {
  if (!apiKey) throw new Error('wvJudge: GEMINI_API_KEY required');
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });

  const userPrompt = renderUserPrompt({
    task,
    answer: answer || '<no answer text returned by agent>',
    numScreenshots: screenshotsB64.length,
  });

  const parts = [
    { text: userPrompt },
    ...screenshotsB64.map((data) => ({
      inlineData: { mimeType: 'image/png', data },
    })),
    { text: '\nYour verdict:\n' },
  ];

  const res = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts }],
    config: { systemInstruction: SYSTEM_PROMPT, temperature: 0 },
  });

  const reasoning =
    res.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text ?? '';
  const verdict = parseVerdict(reasoning);
  return { passed: verdict === true, verdict, reasoning };
}
