// Adapter around the Gemini 3.5 Flash Computer Use loop.
//
// API contract (pinned from Google docs, 2026-06; public preview):
//   tools : [{ computerUse: { environment: 'ENVIRONMENT_BROWSER' } }]
//   loop  : send screenshot + goal -> model returns parts[] with a
//           functionCall { name, args } where args includes `intent`
//           coords are normalized 0..999 -> denormalize to pixels -> execute
//           -> capture next screenshot -> reply with functionResponse
//              containing the new screenshot + current URL -> repeat
//           a turn with NO functionCall in any part is the completion signal.
//   model : 'gemini-3.5-flash'
//
// The live call needs GEMINI_API_KEY + @google/genai and is wired below.
// For tests/demo, inject `modelFn` so the loop runs with no key.

export const denormalize = (v, size) => Math.round((v / 1000) * size);

const DONE = { type: 'done' };

// Map Gemini's function-call vocabulary to our internal action shape.
// Returns { action, intent } where action.type is one of:
//   click | double_click | triple_click | type | scroll | navigate
//   press_key | hotkey | drag_and_drop | wait | go_back | go_forward
//   take_screenshot | done
// plus whatever arg fields the model supplied (x, y, text, key, url, ...).
function actionFromFunctionCall(fc) {
  const { intent = '', ...rest } = fc.args ?? {};
  return { action: { type: fc.name, ...rest }, intent };
}

export class GeminiComputerUse {
  constructor({
    apiKey = process.env.GEMINI_API_KEY,
    model = 'gemini-3.5-flash',
    environment = 'browser',
    modelFn = null,
    enablePromptInjectionDetection = true,
  } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.environment = environment;
    this.modelFn = modelFn;
    this.enablePromptInjectionDetection = enablePromptInjectionDetection;
    this._client = null;
  }

  async _ensureClient() {
    if (this._client) return this._client;
    if (!this.apiKey) {
      throw new Error(
        'GEMINI_API_KEY missing. Set it in env, or inject `modelFn` for mock mode.'
      );
    }
    const { GoogleGenAI } = await import('@google/genai');
    this._client = new GoogleGenAI({ apiKey: this.apiKey });
    return this._client;
  }

  _toolConfig() {
    const envEnum =
      this.environment === 'browser'
        ? 'ENVIRONMENT_BROWSER'
        : this.environment === 'mobile'
        ? 'ENVIRONMENT_MOBILE'
        : 'ENVIRONMENT_DESKTOP';
    return {
      computerUse: {
        environment: envEnum,
        ...(this.enablePromptInjectionDetection
          ? { enablePromptInjectionDetection: true }
          : {}),
      },
    };
  }

  // Mock-mode shim. Real loop uses `runTask` directly, which maintains
  // multi-turn contents and only calls the SDK.
  async proposeAction({ goal, screenshot, history = [], skills = [] }) {
    if (this.modelFn) return this.modelFn({ goal, screenshot, history, skills });
    throw new Error(
      'proposeAction() is mock-only. For live runs call runTask(); it owns the multi-turn loop.'
    );
  }

  // Build the initial user turn: skill notes (if any) + goal + screenshot.
  _initialContents({ goal, screenshotB64, skills }) {
    const parts = [];
    if (skills && skills.length) {
      const skillText = skills
        .map((s) => `- ${s.title}: ${s.note}`)
        .join('\n');
      parts.push({
        text:
          'Learned skills relevant to this task family (apply if applicable):\n' +
          skillText,
      });
    }
    parts.push({ text: goal });
    parts.push({
      inlineData: { mimeType: 'image/png', data: screenshotB64 },
    });
    return [{ role: 'user', parts }];
  }

  // Drive a task to completion (or maxSteps).
  // `env` implements: screenshot() -> base64 PNG string, execute(action),
  //   size() -> {width,height}, [reset()], [currentUrl()].
  async runTask({ goal, env, skills = [], maxSteps = 25 }) {
    const trajectory = [];

    // Mock path: keep old per-step interface so demo/mockRun.js still works.
    if (this.modelFn) {
      for (let step = 0; step < maxSteps; step++) {
        const screenshot = await env.screenshot();
        const { action, intent } = await this.modelFn({
          goal,
          screenshot,
          history: trajectory,
          skills,
        });
        trajectory.push({ step, action, intent });
        if (action.type === 'done') break;
        const { width, height } = env.size();
        const px =
          action.x != null
            ? {
                x: denormalize(action.x, width),
                y: denormalize(action.y, height),
              }
            : {};
        await env.execute({ ...action, ...px });
      }
      return trajectory;
    }

    // Live path.
    const ai = await this._ensureClient();
    const tool = this._toolConfig();

    const screenshotB64 = await env.screenshot();
    let contents = this._initialContents({ goal, screenshotB64, skills });

    for (let step = 0; step < maxSteps; step++) {
      const res = await ai.models.generateContent({
        model: this.model,
        contents,
        config: { tools: [tool] },
      });

      const candidate = res.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      const fcPart = parts.find((p) => p.functionCall);

      if (!fcPart) {
        // No function call -> model considers the task done (or refused).
        const text = parts.find((p) => p.text)?.text ?? '';
        trajectory.push({ step, action: DONE, intent: text });
        break;
      }

      const fcId = fcPart.functionCall.id; // required on Gemini 3.5+ functionResponse
      const { action, intent } = actionFromFunctionCall(fcPart.functionCall);
      trajectory.push({ step, action, intent });

      // Safety acknowledgement: if the SDK surfaces a safety_decision
      // requiring confirmation, we ack and continue. (Permissive default
      // for the demo; tighten before running on real accounts.)
      const safetyAck = candidate?.safetyDecision?.decision === 'require_confirmation';

      // Translate normalized coords to pixels for execution.
      const { width, height } = env.size();
      const px =
        action.x != null
          ? {
              x: denormalize(action.x, width),
              y: denormalize(action.y, height),
            }
          : {};
      try {
        await env.execute({ ...action, ...px });
      } catch (e) {
        // Surface execution errors back to the model so it can adapt.
        contents.push({ role: 'model', parts });
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                ...(fcId ? { id: fcId } : {}),
                name: fcPart.functionCall.name,
                response: { error: String(e?.message ?? e) },
              },
            },
          ],
        });
        continue;
      }

      const nextShot = await env.screenshot();
      const url = env.currentUrl ? env.currentUrl() : undefined;

      contents.push({ role: 'model', parts });
      contents.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              ...(fcId ? { id: fcId } : {}),
              name: fcPart.functionCall.name,
              response: {
                ...(url ? { url } : {}),
                ...(safetyAck ? { safetyAcknowledgement: true } : {}),
              },
              parts: [
                {
                  inlineData: { mimeType: 'image/png', data: nextShot },
                },
              ],
            },
          },
        ],
      });
    }

    return trajectory;
  }
}
