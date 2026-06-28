#!/usr/bin/env node
// Runs the 10th trial of ArXiv--23 (1 baseline + 1 retry) with the
// Chromium window positioned on the right half of the screen so the
// surrounding screen recording captures both the agent driving the
// browser AND the streamed trajectory on the left-half Terminal.
//
// LIVE_TRACE=1 makes geminiCua.js print each action + intent to stderr
// as the model emits it, so the Terminal panel narrates what the
// Chromium window is doing in real time.
//
// Usage:
//   GEMINI_API_KEY=... LIVE_TRACE=1 node demo/recordedRun.js ArXiv--23
//
// Side effects:
//   - Opens a headed Chromium window positioned at WINDOW_X / WINDOW_Y
//   - Writes per-trial artifacts under demo/results/recorded-<task>/

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { GeminiComputerUse } from '../src/geminiCua.js';
import { SkillStore } from '../src/skillStore.js';
import { createBrowserEnv } from '../src/playwrightEnv.js';
import { wvJudge } from '../src/wvJudge.js';

if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY not set');
  process.exit(1);
}
process.env.LIVE_TRACE = process.env.LIVE_TRACE ?? '1';

const argId = process.argv[2] ?? 'ArXiv--23';
const WINDOW_X = Number(process.env.WINDOW_X ?? 1280);
const WINDOW_Y = Number(process.env.WINDOW_Y ?? 30);
const VIEWPORT_W = Number(process.env.VIEWPORT_W ?? 1200);
const VIEWPORT_H = Number(process.env.VIEWPORT_H ?? 1280);
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 30);

const tasks = new Map(
  readFileSync('./webvoyager_data/WebVoyager_data.jsonl', 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const t = JSON.parse(l);
      return [t.id, t];
    })
);
const task = tasks.get(argId);
if (!task) { console.error(`unknown task ${argId}`); process.exit(1); }

const store = new SkillStore({ path: './skills.json' });
const skills = store.all();
if (!skills.length) {
  console.error('No skills in store. Cannot record the retry condition.');
  process.exit(1);
}

const agent = new GeminiComputerUse({ environment: 'browser' });

const outRoot = `./demo/results/recorded-${argId}`;
if (existsSync(outRoot)) rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

const C = { dim: '\x1b[2m', cyan: '\x1b[1;36m', yellow: '\x1b[1;33m', green: '\x1b[1;32m', red: '\x1b[1;31m', reset: '\x1b[0m' };

function wrapGoal(g) {
  return g + "\n\nWhen you have the answer, finish your turn by writing the answer in natural language (name + the specific values the task asked for). Don't just say 'done'.";
}

async function runOne({ skillsToUse, condition }) {
  console.log(`\n${C.cyan}━━━ ${condition.toUpperCase()} — ${argId} ━━━${C.reset}`);
  console.log(`${C.dim}task:${C.reset} ${task.ques}\n`);
  const env = await createBrowserEnv({
    headless: false,
    startUrl: task.web,
    viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
    windowPosition: { x: WINDOW_X, y: WINDOW_Y },
  });
  let traj = [], err = null;
  try {
    traj = await agent.runTask({ goal: wrapGoal(task.ques), env, skills: skillsToUse, maxSteps: MAX_STEPS });
  } catch (e) {
    err = String(e?.message ?? e);
  }
  const finalShot = await env.screenshot();
  const finalUrl = env.currentUrl();
  const finalAnswer = traj.length ? traj[traj.length - 1].intent ?? '' : '';
  await env.close();

  console.log(`\n${C.dim}grading via WebVoyager auto-eval prompt...${C.reset}`);
  const j = err
    ? { passed: false, reasoning: 'harness error: ' + err }
    : await wvJudge({ task: task.ques, answer: finalAnswer, screenshotsB64: [finalShot] });
  const color = j.passed ? C.green : C.red;
  console.log(`${color}verdict: ${j.passed ? 'SUCCESS' : 'NOT SUCCESS'}${C.reset}  steps=${traj.length}\n`);

  writeFileSync(`${outRoot}/${condition}.json`, JSON.stringify({
    condition, passed: j.passed, steps: traj.length, finalUrl, finalAnswer,
    trajectory: traj, judge: j,
  }, null, 2));
  writeFileSync(`${outRoot}/${condition}-final.png`, Buffer.from(finalShot, 'base64'));
  return { passed: j.passed, steps: traj.length };
}

// 1) Baseline: no skill, expected to fail (budget exhausted on form)
const b = await runOne({ skillsToUse: [], condition: 'baseline' });

// Brief pause so the recording reads as two distinct sections
console.log(`${C.yellow}--- pausing 4s before retry condition ---${C.reset}`);
await new Promise((r) => setTimeout(r, 4000));

// 2) Retry: skill loaded, expected to pass via URL-construction strategy
const r = await runOne({ skillsToUse: skills, condition: 'retry' });

writeFileSync(`${outRoot}/summary.json`, JSON.stringify({
  task: argId, baseline: b, retry: r,
  conclusion: `baseline ${b.passed ? 'PASS' : 'FAIL'} (${b.steps} steps), retry ${r.passed ? 'PASS' : 'FAIL'} (${r.steps} steps)`,
}, null, 2));

console.log(`\n${C.cyan}━━━ Recorded trial complete ━━━${C.reset}`);
console.log(`baseline: ${b.passed ? 'PASS' : 'FAIL'} (${b.steps} steps)`);
console.log(`retry   : ${r.passed ? 'PASS' : 'FAIL'} (${r.steps} steps)`);
console.log(`artifacts -> ${outRoot}/`);
