// Adapter around the Gemini 3.5 Flash Computer Use loop.
//
// API contract (pinned from Google docs, 2026-06; public preview):
//   tools: [{ type: 'computer_use', environment: 'browser'|'desktop'|'mobile' }]
//   loop : send screenshot + goal  ->  model returns a function call { action, intent }
//          coords are normalized 0..1000  ->  denormalize to pixels  ->  execute
//          ->  capture next screenshot  ->  repeat until action.type === 'done'
//   model: 'gemini-3.5-flash'
//
// The live call needs GEMINI_API_KEY + @google/genai and is wired at the venue.
// For tests/demo, inject `modelFn` so the loop runs with no key.

export const denormalize = (v, size) => Math.round((v / 1000) * size);

export class GeminiComputerUse {
  constructor({ apiKey, model = 'gemini-3.5-flash', environment = 'browser', modelFn = null } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.environment = environment;
    this.modelFn = modelFn; // inject a fn for mock/testing; null => real API
  }

  // -> { action: { type, x?, y?, text?, key? }, intent: string }
  async proposeAction({ goal, screenshot, history = [], skills = [] }) {
    if (this.modelFn) return this.modelFn({ goal, screenshot, history, skills });

    // === REAL CALL — wire at the venue with a key ===
    // import { GoogleGenAI } from '@google/genai';
    // const ai = new GoogleGenAI({ apiKey: this.apiKey });
    // const res = await ai.models.generateContent({
    //   model: this.model,
    //   contents: buildContents({ goal, screenshot, history, skills }),
    //   config: { tools: [{ type: 'computer_use', environment: this.environment }] },
    // });
    // return parseComputerCall(res); // -> { action, intent }
    throw new Error(
      'Live Gemini CU call not wired. Inject modelFn for mock, or implement with @google/genai + GEMINI_API_KEY.'
    );
  }

  // Drive a task to completion (or maxSteps).
  // `env` implements: screenshot(), execute(action), size(), [reset()].
  async runTask({ goal, env, skills = [], maxSteps = 25 }) {
    const trajectory = [];
    for (let step = 0; step < maxSteps; step++) {
      const screenshot = await env.screenshot();
      const { action, intent } = await this.proposeAction({ goal, screenshot, history: trajectory, skills });
      trajectory.push({ step, action, intent });
      if (action.type === 'done') break;
      const { width, height } = env.size();
      const px = action.x != null ? { x: denormalize(action.x, width), y: denormalize(action.y, height) } : {};
      await env.execute({ ...action, ...px });
    }
    return trajectory;
  }
}
