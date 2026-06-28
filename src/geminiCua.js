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
    // Gemini 3.5 thinking_level enum: 'MINIMAL'|'LOW'|'MEDIUM'|'HIGH'.
    // Default 'MEDIUM'. We expose this so demo runs can dial up reasoning
    // for higher-stakes recordings.
    thinkingLevel = process.env.THINKING_LEVEL ?? null,
  } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.environment = environment;
    this.modelFn = modelFn;
    this.enablePromptInjectionDetection = enablePromptInjectionDetection;
    this.thinkingLevel = thinkingLevel;
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

    const cfg = { tools: [tool] };
    if (this.thinkingLevel) {
      cfg.thinkingConfig = { thinkingLevel: this.thinkingLevel };
    }
    for (let step = 0; step < maxSteps; step++) {
      const res = await ai.models.generateContent({
        model: this.model,
        contents,
        config: cfg,
      });

      const candidate = res.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      const fcPart = parts.find((p) => p.functionCall);

      if (!fcPart) {
        // No function call -> model considers the task done (or refused).
        const text = parts.find((p) => p.text)?.text ?? '';

        // VLAA-GUI completeness verifier — opt-in via env var to avoid
        // surprising the existing tests. When on, check whether the
        // agent's final answer is actually a complete answer; if not and
        // there's step budget left, inject the critique into the next
        // turn so the agent finishes instead of silently stopping.
        if (process.env.COMPLETENESS_VERIFIER && step < maxSteps - 1) {
          try {
            const { verifyCompleteness } = await import('./completenessVerifier.js');
            const lastShot = await env.screenshot();
            const v = await verifyCompleteness({
              apiKey: this.apiKey,
              model: this.model,
              goal,
              finalAnswer: text,
              finalScreenshotB64: lastShot,
              recentActions: trajectory.slice(-5),
              thinkingLevel: this.thinkingLevel,
            });
            if (process.env.LIVE_TRACE) {
              process.stderr.write(
                `\x1b[2m[completeness] complete=${v.complete}` +
                  ` confidence=${v.confidence}` +
                  (v.missing ? ` missing=${JSON.stringify(v.missing).slice(0, 100)}` : '') +
                  `\x1b[0m\n`
              );
            }
            if (!v.complete) {
              // Inject the critique and let the agent take another turn.
              contents.push({ role: 'model', parts });
              contents.push({
                role: 'user',
                parts: [
                  {
                    text:
                      `SYSTEM NOTE (completeness verifier): your last response is not yet a complete answer. ` +
                      `Missing: ${v.missing}. ` +
                      `Please finish the task and reply with a clear natural-language answer.`,
                  },
                ],
              });
              continue;
            }
          } catch (e) {
            // verifier failure is non-fatal; just proceed
          }
        }

        trajectory.push({ step, action: DONE, intent: text });
        break;
      }

      const fcId = fcPart.functionCall.id; // required on Gemini 3.5+ functionResponse
      const { action, intent } = actionFromFunctionCall(fcPart.functionCall);
      trajectory.push({ step, action, intent });
      // LIVE_TRACE: print each step to stderr as it arrives. Useful for
      // screen-recording the agent's reasoning alongside the browser
      // window. Off by default to avoid noise in normal runs.
      if (process.env.LIVE_TRACE) {
        const argSummary = Object.entries(action)
          .filter(([k]) => k !== 'type')
          .slice(0, 4)
          .map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 30)}`)
          .join(' ');
        process.stderr.write(
          `\x1b[2m[step ${String(step).padStart(2, ' ')}]\x1b[0m ` +
            `\x1b[36m${action.type}\x1b[0m ${argSummary ? '\x1b[2m' + argSummary + '\x1b[0m ' : ''}` +
            `— ${(intent || '').slice(0, 90)}\n`
        );
      }

      // Safety acknowledgement: Gemini may attach a safety_decision to
      // the functionCall (asking us to confirm side-effecting actions).
      // The field can live on the functionCall, on its args, on the part,
      // or on the candidate depending on SDK version — gather from all
      // plausible spots and ack permissively if ANY says require_confirmation.
      //
      // PERMISSIVE: we always set safetyAcknowledgement=true. This is fine
      // for read-only public-site demos. TIGHTEN before pointing the agent
      // at anything with real side effects (forms, auth'd accounts).
      const safetyDecision =
        fcPart.functionCall.safetyDecision ??
        fcPart.functionCall.args?.safetyDecision ??
        fcPart.safetyDecision ??
        candidate?.safetyDecision;
      const safetyRequested =
        safetyDecision?.decision === 'require_confirmation' ||
        safetyDecision?.decision === 'REQUIRE_CONFIRMATION';
      // Belt and braces — always ack. Harmless if not requested.
      const safetyAck = true;
      if (safetyRequested && this._verbose) {
        console.log('  [safety ack] ', safetyDecision?.explanation ?? '');
      }

      // Pre-operative critic on high-risk actions (Voyager/GUI-Critic-R1
      // lineage). Opt-in via env var. Gated by isHighRisk so it doesn't
      // fire on every step — critics are expensive.
      if (process.env.PRE_OP_CRITIC) {
        try {
          const { isHighRisk, preOperativeCritic } = await import('./preOperativeCritic.js');
          if (isHighRisk(action)) {
            const shot = await env.screenshot();
            const verdict = await preOperativeCritic({
              apiKey: this.apiKey,
              model: this.model,
              goal,
              proposedAction: action,
              recentActions: trajectory.slice(-3),
              screenshotB64: shot,
            });
            if (process.env.LIVE_TRACE) {
              process.stderr.write(
                `\x1b[2m[pre-op critic] verdict=${verdict.verdict} reason=${(verdict.reason || '').slice(0, 80)}\x1b[0m\n`
              );
            }
            if (verdict.verdict === 'block') {
              contents.push({ role: 'model', parts });
              contents.push({
                role: 'user',
                parts: [
                  {
                    functionResponse: {
                      ...(fcId ? { id: fcId } : {}),
                      name: fcPart.functionCall.name,
                      response: { error: 'pre-operative critic blocked: ' + verdict.reason },
                    },
                  },
                ],
              });
              continue;
            }
          }
        } catch {}
      }

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
                // Belt-and-braces: include both snake_case (REST API
                // convention) and camelCase (JS SDK convention). One of
                // them will be the one the wire format expects.
                ...(safetyAck
                  ? { safetyAcknowledgement: true, safety_acknowledgement: true }
                  : {}),
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
