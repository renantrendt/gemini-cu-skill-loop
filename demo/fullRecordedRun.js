#!/usr/bin/env node
// Full iterative recorded run, SOTA-informed edition.
//
// What's new vs the v1 version (per the SOTA workflow synthesis):
//   - Skill schema extended with `strategy_category` and `branches`
//     (Voyager/EvoSkill 1-procedure baseline + CUA-Skill execution-graph
//     branches for brittle widgets).
//   - Loop detector: every iteration's distiller is told which strategy
//     categories the prior rejected skills used, and asked to propose a
//     SKILL IN A DIFFERENT CATEGORY. Breaks the "Cmd+F basin" failure
//     mode we observed empirically.
//   - Hybrid distiller: each distillation call gets the failed
//     trajectory's FINAL screenshot (and, on iter k>=2, also the prior
//     retry's final screenshot). Mirrors EchoTrail-GUI's keyframe
//     pattern, not full-trajectory frames.
//   - Pass COMPLETENESS_VERIFIER=1 + PRE_OP_CRITIC=1 through to
//     geminiCua.js so the agent's per-trial loop gets VLAA-GUI-style
//     completeness checks on `done` and Voyager-style pre-operative
//     critics on high-risk actions.
//
// Env knobs:
//   MAX_ITERATIONS   default 3
//   MAX_STEPS        default 30
//   THINKING_LEVEL   MINIMAL|LOW|MEDIUM|HIGH for agent
//   DISTILL_THINKING_LEVEL  same for distiller (defaults to THINKING_LEVEL)
//   COMPLETENESS_VERIFIER=1 turn on per-trial completeness check
//   PRE_OP_CRITIC=1  turn on pre-operative critic on high-risk actions
//   WINDOW_X/Y, VIEWPORT_W/H  Chromium position + viewport

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { GeminiComputerUse } from '../src/geminiCua.js';
import { createBrowserEnv } from '../src/playwrightEnv.js';
import { wvJudge } from '../src/wvJudge.js';

if (!process.env.GEMINI_API_KEY) { console.error('GEMINI_API_KEY not set'); process.exit(1); }
process.env.LIVE_TRACE = process.env.LIVE_TRACE ?? '1';

const argId = process.argv[2] ?? 'ArXiv--23';
const WINDOW_X = Number(process.env.WINDOW_X ?? 1280);
const WINDOW_Y = Number(process.env.WINDOW_Y ?? 30);
const VIEWPORT_W = Number(process.env.VIEWPORT_W ?? 1200);
const VIEWPORT_H = Number(process.env.VIEWPORT_H ?? 1280);
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 30);
const MAX_ITERATIONS = Number(process.env.MAX_ITERATIONS ?? 3);
const THINKING_LEVEL = process.env.THINKING_LEVEL ?? null;
const DISTILL_THINKING_LEVEL = process.env.DISTILL_THINKING_LEVEL ?? THINKING_LEVEL;

const tasks = new Map(
  readFileSync('./webvoyager_data/WebVoyager_data.jsonl', 'utf8')
    .split('\n').filter(Boolean).map((l) => { const t = JSON.parse(l); return [t.id, t]; })
);
const task = tasks.get(argId);
if (!task) { console.error(`unknown task ${argId}`); process.exit(1); }

const agent = new GeminiComputerUse({ environment: 'browser', thinkingLevel: THINKING_LEVEL });

const outRoot = `./demo/results/full-recorded-${argId}`;
if (existsSync(outRoot)) rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  cyan: '\x1b[36m', yellow: '\x1b[33m', green: '\x1b[32m', red: '\x1b[31m', magenta: '\x1b[35m', blue: '\x1b[34m',
};
const sep = () => '━'.repeat(78);
const header = (text, color = C.cyan) => {
  console.log(`\n${color}${sep()}${C.reset}`);
  console.log(`${C.bold}${color}  ${text}${C.reset}`);
  console.log(`${color}${sep()}${C.reset}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const wrapGoal = (g) =>
  g + "\n\nEnvironment: this browser is running on macOS — use Cmd+key (not Ctrl+key) for keyboard shortcuts. " +
  "Note: the browser's find-in-page UI lives in the browser chrome above the page, so it is NOT visible in your screenshots.\n\n" +
  "When you have the answer, finish your turn by writing the answer in natural language " +
  "(name + the specific values the task asked for). Don't just say 'done'.";

async function runTaskHeaded({ phaseLabel, skillsToUse }) {
  const env = await createBrowserEnv({
    headless: false,
    startUrl: task.web,
    viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
    windowPosition: { x: WINDOW_X, y: WINDOW_Y },
  });
  let traj = [], err = null;
  try {
    traj = await agent.runTask({ goal: wrapGoal(task.ques), env, skills: skillsToUse, maxSteps: MAX_STEPS });
  } catch (e) { err = String(e?.message ?? e); }
  const shot = await env.screenshot();
  const url = env.currentUrl();
  const answer = traj.length ? traj[traj.length - 1].intent ?? '' : '';
  await env.close();
  const j = err
    ? { passed: false, reasoning: 'harness error: ' + err }
    : await wvJudge({ task: task.ques, answer, screenshotsB64: [shot] });
  writeFileSync(`${outRoot}/${phaseLabel}.json`, JSON.stringify({
    phase: phaseLabel, skillsApplied: skillsToUse.map((s) => ({ tag: s.tag, title: s.title, strategy_category: s.strategy_category })),
    passed: j.passed, steps: traj.length, finalUrl: url, finalAnswer: answer,
    trajectory: traj, judge: j,
  }, null, 2));
  writeFileSync(`${outRoot}/${phaseLabel}-final.png`, Buffer.from(shot, 'base64'));
  return { traj, url, answer, passed: j.passed, steps: traj.length, judge: j, finalShotB64: shot };
}

const { GoogleGenAI } = await import('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Strategy categories we ask the distiller to choose from. Plain
// English to keep the model free-form but anchored.
const STRATEGY_CATEGORIES = [
  'url-construction',     // navigate directly to a URL with query params
  'form-filling',         // interact with on-page form inputs
  'keyboard-shortcut',    // os/browser shortcuts (cmd-key)
  'scroll-and-read',      // page-level scrolling + visual scan
  'dom-extraction',       // request page text content / api endpoint
  'menu-navigation',      // click through menus/tabs to a destination
  'other',
];

function buildDistillerPrompt({ failedTraj, priorSkills, iterationNum, retriesFailedSoFar }) {
  const trajText = failedTraj.map((t, i) => {
    const a = t.action ?? {};
    const args = Object.entries(a).filter(([k]) => k !== 'type').map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ');
    return `  ${i}. ${a.type}${args ? ' ' + args : ''}  // ${t.intent ?? ''}`;
  }).join('\n');

  const triedCategories = priorSkills
    .map((s) => s.strategy_category)
    .filter(Boolean);
  const diversityBlock = triedCategories.length
    ? `\nSTRATEGY CATEGORIES ALREADY TRIED AND REJECTED (the retries that used these did NOT pass):\n` +
      `  ${[...new Set(triedCategories)].join(', ')}\n` +
      `\nThis iteration MUST propose a skill in a DIFFERENT strategy_category from the list above.\n` +
      `Available categories: ${STRATEGY_CATEGORIES.join(', ')}.\n`
    : `\nAvailable strategy_category values: ${STRATEGY_CATEGORIES.join(', ')}.\n`;

  const priorBlock = priorSkills.length
    ? `\nSKILLS ALREADY TRIED AND REJECTED (verbatim):\n` +
      priorSkills.map((s, i) => `  ${i + 1}. [${s.strategy_category ?? '?'}] [${s.tag}] ${s.title}\n     ${s.note}`).join('\n') + '\n'
    : '';

  return `You are distilling a reusable UI skill from a failed agent trajectory. The agent uses Gemini Computer Use to drive a browser on macOS.

ITERATION ${iterationNum} of the skill loop. Retries failed so far: ${retriesFailedSoFar}.

GOAL THE AGENT WAS GIVEN:
${task.ques}

FAILED TRAJECTORY FROM THE LATEST ATTEMPT (per step: action  // agent intent):
${trajText}
${priorBlock}${diversityBlock}
You are also given the screenshot of the final state of the failed attempt (and, on later iterations, the prior retry's final state).

Think step-by-step out loud:
1. What specifically did the agent struggle with on this trajectory?
2. If prior skills were tried, what category did they fall into, and why didn't they close the gap?
3. What durable, transferable approach in a NEW category would have worked?
4. Should this skill have any guarded branches (fallbacks) for known failure modes?

After your reasoning, output a single JSON object on a new line with this exact schema:
{
  "tag": "<kebab-case keyword>",
  "title": "<<=10 words>",
  "note": "<1-3 sentences of concrete guidance>",
  "strategy_category": "<one of: ${STRATEGY_CATEGORIES.join(', ')}>",
  "branches": [
    { "if": "<precondition>", "then": "<fallback action>" }
  ]
}

"branches" is optional — include it only if there's a clear fallback. Order branches by likelihood.`;
}

async function streamDistill({ failedTraj, priorSkills, iterationNum, retriesFailedSoFar, finalScreenshotB64, priorRetryShotB64 = null }) {
  const prompt = buildDistillerPrompt({ failedTraj, priorSkills, iterationNum, retriesFailedSoFar });
  const cfg = { temperature: 0 };
  if (DISTILL_THINKING_LEVEL) cfg.thinkingConfig = { thinkingLevel: DISTILL_THINKING_LEVEL };
  const parts = [{ text: prompt }];
  if (finalScreenshotB64) parts.push({ inlineData: { mimeType: 'image/png', data: finalScreenshotB64 } });
  if (priorRetryShotB64) parts.push({ inlineData: { mimeType: 'image/png', data: priorRetryShotB64 } });
  const stream = await ai.models.generateContentStream({
    model: 'gemini-3.5-flash',
    contents: [{ role: 'user', parts }],
    config: cfg,
  });
  let full = '';
  for await (const chunk of stream) {
    const text = chunk.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!text) continue;
    full += text;
    process.stdout.write(text);
  }
  process.stdout.write('\n\n');
  // The model may emit a JSON object with nested arrays — grab the first
  // top-level object whose first key is "tag".
  const m = full.match(/\{\s*"tag"[\s\S]*\}/);
  if (!m) throw new Error('distiller did not emit a JSON skill object');
  // Try parsing from the matched start, trimming trailing junk if needed.
  let skill = null;
  for (let end = m.index + m[0].length; end > m.index + 30; end--) {
    try { skill = JSON.parse(full.slice(m.index, end)); break; } catch {}
  }
  if (!skill) throw new Error('distiller emitted unparseable JSON');
  return { full, skill };
}

// =========================================================================
header(`gemini-cu-skill-loop — full iterative run    task: ${argId}`, C.magenta);
console.log(`${C.dim}task     :${C.reset} ${task.ques}`);
console.log(`${C.dim}site     :${C.reset} ${task.web}`);
console.log(`${C.dim}max iter :${C.reset} ${MAX_ITERATIONS}`);
console.log(`${C.dim}thinking :${C.reset} agent=${THINKING_LEVEL ?? 'default'}  distill=${DISTILL_THINKING_LEVEL ?? 'default'}`);
console.log(`${C.dim}features :${C.reset} completeness=${process.env.COMPLETENESS_VERIFIER ? 'on' : 'off'}  pre-op-critic=${process.env.PRE_OP_CRITIC ? 'on' : 'off'}`);
console.log(`${C.dim}distiller:${C.reset} sees the final screenshot of each failure (and the latest retry on iter 2+)`);

// PHASE 1 — Baseline ------------------------------------------------------
header('PHASE 1 — BASELINE  (no skill in context)', C.red);
console.log(`${C.dim}Each Computer Use step + intent streams below.${C.reset}\n`);

const baseline = await runTaskHeaded({ phaseLabel: 'baseline', skillsToUse: [] });
console.log(`\n${C.red}>>> BASELINE VERDICT: ${baseline.passed ? 'SUCCESS' : 'NOT SUCCESS'}${C.reset} ${C.dim}(${baseline.steps} steps)${C.reset}`);

if (baseline.passed) {
  console.log(`\n${C.green}Baseline passed without a skill — nothing to distill.${C.reset}`);
  writeFileSync(`${outRoot}/summary.json`, JSON.stringify({ task: argId, baselinePassed: true, iterations: [] }, null, 2));
  process.exit(0);
}

// Iterative skill loop ---------------------------------------------------
const priorSkills = [];
const iterations = [];
let kept = null;

let latestFailedTraj = baseline.traj;
let latestFailedShotB64 = baseline.finalShotB64;
let priorRetryShotB64 = null;

for (let i = 1; i <= MAX_ITERATIONS; i++) {
  await sleep(2500);
  const triedCats = [...new Set(priorSkills.map(s => s.strategy_category).filter(Boolean))];
  header(`ITERATION ${i} of ${MAX_ITERATIONS} — DISTILLER`, C.yellow);
  console.log(`${C.dim}Prior rejected skills: ${priorSkills.length}. Categories already tried: ${triedCats.join(', ') || '(none)'}.${C.reset}`);
  console.log(`${C.dim}Distiller will be asked to propose a skill in a DIFFERENT category.${C.reset}\n`);

  let skill, reasoning;
  try {
    const out = await streamDistill({
      failedTraj: latestFailedTraj,
      priorSkills,
      iterationNum: i,
      retriesFailedSoFar: priorSkills.length,
      finalScreenshotB64: latestFailedShotB64,
      priorRetryShotB64,
    });
    skill = out.skill;
    reasoning = out.full;
  } catch (e) {
    console.error(`${C.red}!!! distillation failed: ${e.message}${C.reset}`);
    iterations.push({ iteration: i, error: e.message });
    break;
  }
  writeFileSync(`${outRoot}/distiller-iter${i}-reasoning.txt`, reasoning);
  writeFileSync(`${outRoot}/distiller-iter${i}-skill.json`, JSON.stringify(skill, null, 2));

  console.log(`${C.green}>>> SKILL ${i} DISTILLED${C.reset}`);
  console.log(`${C.dim}tag      :${C.reset}  ${C.bold}${skill.tag}${C.reset}`);
  console.log(`${C.dim}category :${C.reset}  ${C.bold}${skill.strategy_category}${C.reset}`);
  console.log(`${C.dim}title    :${C.reset}  ${C.bold}${skill.title}${C.reset}`);
  console.log(`${C.dim}note     :${C.reset}  ${skill.note}`);
  if (skill.branches?.length) {
    console.log(`${C.dim}branches :${C.reset}`);
    for (const b of skill.branches) {
      console.log(`  - if ${b.if} → ${b.then}`);
    }
  }

  await sleep(2500);

  header(`ITERATION ${i} — RETRY  (skills in context: ${priorSkills.length + 1})`, C.green);
  console.log(`${C.dim}Running with all prior rejected skills + the new one as context.${C.reset}\n`);
  const skillsForThisRetry = [...priorSkills, skill];
  const retry = await runTaskHeaded({ phaseLabel: `retry-iter${i}`, skillsToUse: skillsForThisRetry });
  console.log(`\n${retry.passed ? C.green : C.red}>>> RETRY ${i} VERDICT: ${retry.passed ? 'SUCCESS' : 'NOT SUCCESS'}${C.reset} ${C.dim}(${retry.steps} steps)${C.reset}`);

  iterations.push({ iteration: i, skill, retry: { passed: retry.passed, steps: retry.steps, finalUrl: retry.url } });

  if (retry.passed) {
    header(`VERIFIED KEEP-GATE  →  SAVE SKILL (iteration ${i})`, C.green);
    console.log(`${C.dim}Baseline:${C.reset} FAIL`);
    console.log(`${C.dim}Iterations to converge:${C.reset} ${i} / ${MAX_ITERATIONS}`);
    console.log(`${C.dim}Saved skill:${C.reset} [${skill.tag}] ${skill.title}`);
    console.log(`${C.dim}Category:${C.reset} ${skill.strategy_category}`);
    kept = skill;
    break;
  } else {
    console.log(`${C.dim}Skill did not produce a pass. Distilling iteration ${i + 1} from this latest failure (and avoiding the [${skill.strategy_category}] category)...${C.reset}`);
    priorSkills.push(skill);
    latestFailedTraj = retry.traj;
    priorRetryShotB64 = retry.finalShotB64;
  }
}

if (!kept) {
  header(`VERIFIED KEEP-GATE  →  DISCARD all ${priorSkills.length} skills`, C.red);
  console.log(`${C.dim}No iteration produced a verified pass across categories: ${[...new Set(priorSkills.map(s => s.strategy_category).filter(Boolean))].join(', ')}.${C.reset}`);
  console.log(`${C.dim}This is the keep-gate doing its job: net-positive-by-construction.${C.reset}`);
}

writeFileSync(`${outRoot}/summary.json`, JSON.stringify({
  task: argId, goal: task.ques,
  baseline: { passed: baseline.passed, steps: baseline.steps, finalUrl: baseline.url },
  iterations, kept,
  totalIterations: iterations.length,
  categoriesTried: [...new Set(iterations.map(it => it.skill?.strategy_category).filter(Boolean))],
  outcome: kept ? 'SKILL_SAVED' : 'ALL_REJECTED_BY_KEEP_GATE',
}, null, 2));

console.log(`\n${C.dim}artifacts -> ${outRoot}/${C.reset}\n`);
