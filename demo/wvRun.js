// WebVoyager runner: drive the Gemini CU agent against live tasks from
// MinorJerry/WebVoyager and grade with the OFFICIAL evaluator prompt
// (see src/wvJudge.js). No hand-rolled URL/DOM checks here — the prompt
// from the benchmark is the verifier.
//
// Pipeline (HARD RULES from project plan):
//   1. Run Gemini 3.5 Flash CU on the task. Extract final-answer text.
//   2. Capture last K screenshots from the trajectory's tail.
//   3. Score with wvJudge using WebVoyager's verbatim system+user prompt.
//   4. Triage every reported failure before believing it. A "failure"
//      counts only if it survives all of:
//        (a) NOT auth/login wall hit
//        (b) NOT a legitimate alternate path taken
//        (c) NOT a safety-confirmation that needed acking
//        (d) NOT a harness/encoding error
//   5. On a real triaged failure: run the skill loop, then test the
//      learned skill on a HELD-OUT instance of the same task template.
//
// Usage:
//   GEMINI_API_KEY=... node demo/wvRun.js                       # full curated subset
//   GEMINI_API_KEY=... node demo/wvRun.js Allrecipes--0          # one task by id
//   HEADLESS=1 SAVE_RESULTS=1 SKILL_LOOP=1 node demo/wvRun.js   # full pipeline
//
// Env knobs:
//   HEADLESS=1        run chromium headless
//   SAVE_RESULTS=1    write judge-facing artifact bundles to demo/results/<id>/
//   SKILL_LOOP=1      on a triaged failure, run distill + retry
//   MAX_STEPS=N       cap per-task step count (default 25)

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { GeminiComputerUse } from '../src/geminiCua.js';
import { SkillStore } from '../src/skillStore.js';
import { runWithSkillLearning } from '../src/skillLoop.js';
import { createBrowserEnv } from '../src/playwrightEnv.js';
import { createDistiller } from '../src/distiller.js';
import { wvJudge } from '../src/wvJudge.js';

if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY not set.');
  process.exit(1);
}

const HEADLESS = !!process.env.HEADLESS;
const SAVE_RESULTS = !!process.env.SAVE_RESULTS;
const SKILL_LOOP = !!process.env.SKILL_LOOP;
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 25);
const argId = process.argv[2];

// Curated subset: login-free, real-time-stable enough for one run, with
// multi-criteria filter procedures that are the lowest-success category
// per the WebVoyager paper. Each has a held-out sibling on the same site
// to test that any learned skill generalises across instances.
const CURATED_IDS = [
  'Allrecipes--0', // primary:  4.5+ stars, >100 reviews, 6 people
  'Allrecipes--1', // held-out: 4+ stars, includes zucchini   (same template: filter recipe by criteria)
  'Allrecipes--2', // held-out: <600 cal, <1hr prep
  'ArXiv--0',      // ArXiv search/filter task
  'ArXiv--1',      // held-out
];

// task template grouping — a learned skill should help across these
const FAMILIES = {
  'Allrecipes--0': { family: 'allrecipes-filter', primary: true,  heldOut: ['Allrecipes--1', 'Allrecipes--2'] },
  'Allrecipes--1': { family: 'allrecipes-filter', primary: false, heldOutOf: 'Allrecipes--0' },
  'Allrecipes--2': { family: 'allrecipes-filter', primary: false, heldOutOf: 'Allrecipes--0' },
  'ArXiv--0':      { family: 'arxiv-search',     primary: true,  heldOut: ['ArXiv--1'] },
  'ArXiv--1':      { family: 'arxiv-search',     primary: false, heldOutOf: 'ArXiv--0' },
  // 'Compare multiple Apple product models' template — Apple--0 is
  // MacBook Air pricing, Apple--2/3 are iPhone Pro/Pro-Max comparisons.
  // Different products + different spec dimensions = honest generalisation
  // test that the distilled skill doesn't just memorise MacBook Air coords.
  'Apple--0':      { family: 'apple-compare-models', primary: true,  heldOut: ['Apple--2', 'Apple--3'] },
  'Apple--2':      { family: 'apple-compare-models', primary: false, heldOutOf: 'Apple--0' },
  'Apple--3':      { family: 'apple-compare-models', primary: false, heldOutOf: 'Apple--0' },
};

// Load WebVoyager data ----------------------------------------------------

function loadTasksJsonl(path) {
  const map = new Map();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const t = JSON.parse(line);
    map.set(t.id, t);
  }
  return map;
}

const TASKS = loadTasksJsonl('./webvoyager_data/WebVoyager_data.jsonl');

const idsToRun = argId ? [argId] : CURATED_IDS.filter((id) => FAMILIES[id]?.primary);

// Goal wrapping: WebVoyager agents are explicitly asked to output an
// 'ANSWER:' line. Our agent ends a task when it returns text without a
// functionCall; nudge it to make that text a real natural-language answer.
function wrapGoal(rawGoal) {
  return (
    rawGoal +
    "\n\nWhen you have the answer, finish your turn by writing the answer in natural language " +
    "(name + the specific values the task asked for). Don't just say 'done'."
  );
}

// Triage helper — flags reported failures that smell like one of the
// known false-failure modes (auth wall, alt path, safety, harness).
function triageFailure({ trajectory, finalUrl, error }) {
  if (error && /safety decision/i.test(error)) return { real: false, reason: 'safety-ack bug (harness)' };
  if (error) return { real: false, reason: `harness error: ${error.slice(0, 120)}` };
  const intents = (trajectory ?? []).map((t) => (t.intent ?? '').toLowerCase()).join(' | ');
  if (/log[- ]?in|sign[- ]?in|permission error|not logged in|please log in/.test(intents))
    return { real: false, reason: 'login wall' };
  if (/captcha|robot check|are you a human/.test(intents))
    return { real: false, reason: 'captcha / bot challenge' };
  if (finalUrl && /login|signin|accounts\.google|auth/.test(finalUrl))
    return { real: false, reason: 'final URL is an auth page' };
  return { real: true };
}

// -----------------------------------------------------------------------

const store = new SkillStore({ path: './skills.json' });
const distiller = createDistiller();
const agent = new GeminiComputerUse({ environment: 'browser' });
const results = [];

// helper: pull the tail K screenshots from the trajectory's environment
// rewinds is impractical (the env is live); easier path is to take a
// screenshot at the END of the task and pass that as the single-frame
// screenshot to the judge. WebVoyager's auto_eval uses last K frames; with
// K=1 we still pass their evaluator, just at the conservative end of the
// frame range.

const resultsDir = (id) => `./demo/results/wv-${id}`;
const saveJSON = (p, d) => writeFileSync(p, JSON.stringify(d, null, 2));
const savePNG = (p, b64) => writeFileSync(p, Buffer.from(b64, 'base64'));

async function runSingle(task, skills = []) {
  const env = await createBrowserEnv({ headless: HEADLESS, startUrl: task.web });
  let traj = [];
  let error = null;
  try {
    traj = await agent.runTask({
      goal: wrapGoal(task.ques),
      env,
      skills,
      maxSteps: MAX_STEPS,
    });
  } catch (e) {
    error = String(e?.message ?? e);
  }
  const finalShotB64 = await env.screenshot();
  const finalUrl = env.currentUrl();
  const finalAnswer = traj.length
    ? traj[traj.length - 1].intent ?? ''
    : '';
  await env.close();
  return { traj, finalShotB64, finalUrl, finalAnswer, error };
}

async function judgeAndTriage(task, runOut) {
  const j = await wvJudge({
    task: task.ques,
    answer: runOut.finalAnswer,
    screenshotsB64: [runOut.finalShotB64],
  });
  let triage = { real: true };
  if (!j.passed) {
    triage = triageFailure({
      trajectory: runOut.traj,
      finalUrl: runOut.finalUrl,
      error: runOut.error,
    });
  }
  return { judge: j, triage };
}

for (const id of idsToRun) {
  const task = TASKS.get(id);
  if (!task) {
    console.error(`unknown task ${id}; skipping`);
    continue;
  }
  console.log(`\n=== ${id}  (${task.web_name}) ===`);
  console.log(`q: ${task.ques}`);

  const outDir = resultsDir(id);
  if (SAVE_RESULTS) {
    if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    saveJSON(`${outDir}/task.json`, task);
  }

  // 1) Baseline run + judge + triage --------------------------------------
  const baseline = await runSingle(task, []);
  const { judge, triage } = await judgeAndTriage(task, baseline);
  console.log(`baseline judge: ${judge.passed ? 'SUCCESS' : 'NOT SUCCESS'}`);
  if (!judge.passed) console.log(`triage: real=${triage.real} (${triage.reason ?? ''})`);

  if (SAVE_RESULTS) {
    saveJSON(`${outDir}/baseline.json`, {
      passed: judge.passed,
      finalAnswer: baseline.finalAnswer,
      finalUrl: baseline.finalUrl,
      trajectory: baseline.traj,
      judge: { passed: judge.passed, reasoning: judge.reasoning },
      triage,
    });
    savePNG(`${outDir}/baseline-final.png`, baseline.finalShotB64);
  }
  results.push({ id, baseline: judge.passed, triagedReal: judge.passed ? null : triage.real });

  // 2) Skill loop branch — only if we have a real triaged failure ---------
  if (!SKILL_LOOP || judge.passed || !triage.real) continue;
  console.log('--- skill loop on real triaged failure ---');

  // Distill from the baseline failure trajectory
  const candidate = await distiller({
    goal: task.ques,
    trajectory: baseline.traj,
    priorSkills: store.match(task.ques),
  });
  if (SAVE_RESULTS) saveJSON(`${outDir}/distilled-skill.json`, candidate);
  console.log(`distilled: [${candidate.tag}] ${candidate.title}`);

  const retry = await runSingle(task, [candidate]);
  const retryGrade = await judgeAndTriage(task, retry);
  console.log(`retry judge: ${retryGrade.judge.passed ? 'SUCCESS' : 'NOT SUCCESS'}`);

  if (SAVE_RESULTS) {
    saveJSON(`${outDir}/retry.json`, {
      passed: retryGrade.judge.passed,
      finalAnswer: retry.finalAnswer,
      finalUrl: retry.finalUrl,
      trajectory: retry.traj,
      judge: { passed: retryGrade.judge.passed, reasoning: retryGrade.judge.reasoning },
    });
    savePNG(`${outDir}/retry-final.png`, retry.finalShotB64);
  }
  results.push({ id: `${id}#retry`, retry: retryGrade.judge.passed });

  // Verified keep-gate: persist skill iff retry passed
  if (retryGrade.judge.passed) {
    const stored = store.add({ id: 'wv-' + Date.now(), ...candidate });
    console.log(`kept skill (verified): ${stored.id}`);

    // 3) Held-out instances of the same template -------------------------
    const heldIds = FAMILIES[id]?.heldOut ?? [];
    for (const hId of heldIds) {
      const hTask = TASKS.get(hId);
      if (!hTask) continue;
      console.log(`-- held-out ${hId} --`);
      const ho = await runSingle(hTask, [stored]);
      const hGrade = await judgeAndTriage(hTask, ho);
      console.log(`held-out judge: ${hGrade.judge.passed ? 'SUCCESS' : 'NOT SUCCESS'}`);
      if (SAVE_RESULTS) {
        const hOut = `${outDir}/heldout-${hId}`;
        mkdirSync(hOut, { recursive: true });
        saveJSON(`${hOut}/result.json`, {
          taskId: hId,
          question: hTask.ques,
          passed: hGrade.judge.passed,
          finalAnswer: ho.finalAnswer,
          finalUrl: ho.finalUrl,
          trajectory: ho.traj,
          judge: { passed: hGrade.judge.passed, reasoning: hGrade.judge.reasoning },
        });
        savePNG(`${hOut}/final.png`, ho.finalShotB64);
      }
      results.push({ id: hId, heldOut: hGrade.judge.passed });
    }
  }
}

console.log('\n=== summary ===');
console.table(results);
console.log(`skills in store: ${store.all().length}`);
