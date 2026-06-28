#!/usr/bin/env node
// Re-run the distillation call on a saved baseline trajectory WITHOUT
// the JSON-only response constraint, capturing the model's pre-JSON
// reasoning. Saves the full response text to
//   demo/results/<bundle>/distillation-reasoning.txt
//
// This is the missing chain-of-thought: the original live distiller used
// responseMimeType=application/json which suppresses prose. The skill
// JSON we already have is unchanged; this is purely about preserving the
// model's explanation of WHY it wrote the skill it wrote.
//
// Usage:
//   GEMINI_API_KEY=... node scripts/recapture-distillation.js wv-ArXiv--23
//
// Cost: ~$0.05 per call. Idempotent if you don't mind paying twice.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY not set');
  process.exit(1);
}
const bundleArg = process.argv[2];
if (!bundleArg) {
  console.error('usage: node scripts/recapture-distillation.js <bundle-name>');
  process.exit(1);
}
const dir = `demo/results/${bundleArg}`;
const baseline = JSON.parse(readFileSync(join(dir, 'baseline.json'), 'utf8'));
const task = JSON.parse(readFileSync(join(dir, 'task.json'), 'utf8'));

const trajectory = baseline.trajectory ?? baseline.traj ?? [];
if (!trajectory.length) {
  console.error('no baseline trajectory in this bundle');
  process.exit(1);
}

const trajText = trajectory
  .map((t, i) => {
    const a = t.action ?? {};
    const args = Object.entries(a)
      .filter(([k]) => k !== 'type')
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(' ');
    return `  ${i}. ${a.type}${args ? ' ' + args : ''}  // ${t.intent ?? ''}`;
  })
  .join('\n');

const prompt = `You are distilling a reusable UI skill from a failed agent trajectory. The agent uses Gemini Computer Use to drive a browser. The original distillation call asked for JSON only — for the public record we want your pre-JSON reasoning preserved alongside.

GOAL THE AGENT WAS GIVEN:
${task.ques ?? task.goal}

FAILED TRAJECTORY (per step: action  // agent intent):
${trajText}

Think step-by-step out loud (this is the chain-of-thought we are preserving):
1. What specifically did the agent struggle with on this trajectory?
2. Where did the wasted steps come from?
3. What approach would have worked better, and why?
4. What durable, transferable lesson does this trajectory teach?

After your reasoning, output a single JSON object on a new line in this exact shape (used by downstream tools):
{"tag":"<kebab-case>","title":"<<=10 words>","note":"<1-3 sentences of concrete guidance>"}`;

const { GoogleGenAI } = await import('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const res = await ai.models.generateContent({
  model: 'gemini-3.5-flash',
  contents: [{ role: 'user', parts: [{ text: prompt }] }],
  config: { temperature: 0 }, // deterministic-ish recapture for archival
});

const text =
  res.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
const outPath = join(dir, 'distillation-reasoning.txt');
writeFileSync(outPath, text);
console.log(`wrote ${outPath}  (${text.length} chars, ${res.usageMetadata?.totalTokenCount ?? '?'} tokens)`);
