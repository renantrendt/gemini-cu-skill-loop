#!/usr/bin/env node
// Demo-friendly variant of recapture-distillation.js: streams the model's
// response token-by-token to the terminal so a screen recording captures
// the distiller "writing the skill" in real time. Otherwise identical
// inputs and outputs to the non-streamed version.
//
// Usage:
//   GEMINI_API_KEY=... node --env-file=.env scripts/recapture-distillation-streamed.js wv-ArXiv--23
//
// Cost: ~$0.05.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY not set');
  process.exit(1);
}
const bundleArg = process.argv[2];
if (!bundleArg) {
  console.error('usage: node scripts/recapture-distillation-streamed.js <bundle-name>');
  process.exit(1);
}
const dir = `demo/results/${bundleArg}`;
const baseline = JSON.parse(readFileSync(join(dir, 'baseline.json'), 'utf8'));
const task = JSON.parse(readFileSync(join(dir, 'task.json'), 'utf8'));

const trajectory = baseline.trajectory ?? baseline.traj ?? [];
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

// ANSI helpers — for video legibility
const C = { dim: '\x1b[2m', bold: '\x1b[1m', cyan: '\x1b[36m', yellow: '\x1b[33m', green: '\x1b[32m', reset: '\x1b[0m' };

console.clear();
console.log(`${C.bold}${C.cyan}━━━ Distillation recapture — ${bundleArg} ━━━${C.reset}\n`);
console.log(`${C.dim}Task:${C.reset} ${task.ques ?? task.goal}\n`);
console.log(`${C.dim}Input:${C.reset} ${trajectory.length} steps of agent action+intent (text, no screenshots)\n`);
console.log(`${C.dim}Model:${C.reset} gemini-3.5-flash @ temperature=0\n`);
console.log(`${C.bold}${C.yellow}--- Distiller (streaming) ---${C.reset}\n`);

const { GoogleGenAI } = await import('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

let full = '';
const stream = await ai.models.generateContentStream({
  model: 'gemini-3.5-flash',
  contents: [{ role: 'user', parts: [{ text: prompt }] }],
  config: { temperature: 0 },
});

for await (const chunk of stream) {
  const text = chunk.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) continue;
  full += text;
  process.stdout.write(text);
}
process.stdout.write('\n\n');

const outPath = join(dir, 'distillation-reasoning.txt');
writeFileSync(outPath, full);
console.log(`${C.green}✓ saved${C.reset} ${outPath}  (${full.length} chars)`);
