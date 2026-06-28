// Reproducibility study for a single WebVoyager task.
//
// Why: a hackathon judge will ask "did you run it once?" — and they'll be
// right to. CU agents are non-deterministic. One fail and one pass tells
// you nothing about the *rate* the skill lifts. This script runs N pure
// baselines (no skill) and N retries (with the saved skill from
// ./skills.json) and prints the pass rates side by side.
//
// Usage:
//   GEMINI_API_KEY=... node demo/reproducibility.js ArXiv--23
//   N=3 HEADLESS=1 SAVE_RESULTS=1 node demo/reproducibility.js ArXiv--23
//
// Knobs:
//   N=N             trials per condition (default 3)
//   HEADLESS=1      headless chromium
//   SAVE_RESULTS=1  per-trial artifacts under demo/results/repro-<task>/<cond>/<n>/
//   MAX_STEPS=N     step cap per trial (default 30)

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { GeminiComputerUse } from '../src/geminiCua.js';
import { SkillStore } from '../src/skillStore.js';
import { createBrowserEnv } from '../src/playwrightEnv.js';
import { wvJudge } from '../src/wvJudge.js';

if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY not set.');
  process.exit(1);
}

const N = Number(process.env.N ?? 3);
const HEADLESS = !!process.env.HEADLESS;
const SAVE_RESULTS = !!process.env.SAVE_RESULTS;
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 30);
// START_TRIAL: 1-indexed trial number to start from. Default 1 = fresh
// run (wipes the output dir). N>=2 = APPEND mode (preserves existing
// trials, appends new ones starting at START_TRIAL).
const START_TRIAL = Number(process.env.START_TRIAL ?? 1);
const APPEND_MODE = START_TRIAL > 1;
const argId = process.argv[2];
if (!argId) {
  console.error('usage: node demo/reproducibility.js <task-id>');
  process.exit(1);
}

const tasksPath = './webvoyager_data/WebVoyager_data.jsonl';
const tasks = new Map(
  readFileSync(tasksPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const t = JSON.parse(l);
      return [t.id, t];
    })
);
const task = tasks.get(argId);
if (!task) {
  console.error(`unknown task ${argId}`);
  process.exit(1);
}

const store = new SkillStore({ path: './skills.json' });
// We pass the kept skill DIRECTLY rather than via store.match(). This
// mirrors the held-out flow in wvRun.js (which passes the kept skill
// straight to runTask) and avoids depending on the store's substring-
// matching, which only fires when the goal happens to contain the tag.
const matchedSkills = store.all();
console.log(`Task : ${argId} on ${task.web}`);
console.log(`Goal : ${task.ques}`);
console.log(`Skills loaded from store: ${matchedSkills.length}`);
matchedSkills.forEach((s) =>
  console.log(`  - [${s.tag}] ${s.title}`)
);
if (matchedSkills.length === 0) {
  console.error('No skills in store — retry condition would be identical to baseline. Aborting.');
  process.exit(1);
}

const agent = new GeminiComputerUse({ environment: 'browser' });

const outRoot = `./demo/results/repro-${argId}`;
if (SAVE_RESULTS) {
  if (!APPEND_MODE && existsSync(outRoot))
    rmSync(outRoot, { recursive: true, force: true });
  mkdirSync(outRoot, { recursive: true });
}

function wrapGoal(rawGoal) {
  return (
    rawGoal +
    "\n\nWhen you have the answer, finish your turn by writing the answer in natural language " +
    "(name + the specific values the task asked for). Don't just say 'done'."
  );
}

async function runOnce({ skills, label, trial }) {
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
  const finalShot = await env.screenshot();
  const finalUrl = env.currentUrl();
  const finalAnswer = traj.length ? traj[traj.length - 1].intent ?? '' : '';
  await env.close();

  const j = error
    ? { passed: false, reasoning: `harness error: ${error}` }
    : await wvJudge({
        task: task.ques,
        answer: finalAnswer,
        screenshotsB64: [finalShot],
      });

  if (SAVE_RESULTS) {
    const dir = `${outRoot}/${label}/${trial}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      `${dir}/result.json`,
      JSON.stringify(
        {
          condition: label,
          trial,
          passed: j.passed,
          finalUrl,
          finalAnswer,
          error,
          steps: traj.length,
          judge: { passed: j.passed, reasoning: j.reasoning },
        },
        null,
        2
      )
    );
    writeFileSync(`${dir}/final.png`, Buffer.from(finalShot, 'base64'));
  }
  return { passed: j.passed, error, steps: traj.length };
}

const results = { baseline: [], retry: [] };

const last = START_TRIAL + N - 1; // inclusive last trial number to run
const label = APPEND_MODE ? `(append trials ${START_TRIAL}..${last})` : `(trials 1..${N})`;
console.log(`Plan: ${N} baseline + ${N} retry trials ${label}`);

for (let i = START_TRIAL; i <= last; i++) {
  console.log(`\n--- baseline ${i} (no skill) ---`);
  const r = await runOnce({ skills: [], label: 'baseline', trial: i });
  results.baseline.push(r);
  console.log(`  passed=${r.passed}  steps=${r.steps}  ${r.error ? '(err: ' + r.error.slice(0, 80) + ')' : ''}`);
}

for (let i = START_TRIAL; i <= last; i++) {
  console.log(`\n--- retry ${i} (with ${matchedSkills.length} skill) ---`);
  const r = await runOnce({ skills: matchedSkills, label: 'retry', trial: i });
  results.retry.push(r);
  console.log(`  passed=${r.passed}  steps=${r.steps}  ${r.error ? '(err: ' + r.error.slice(0, 80) + ')' : ''}`);
}

const rate = (rs) => rs.filter((r) => r.passed).length;
console.log('\n=== this run summary ===');
console.log(`task            : ${argId}`);
console.log(`baseline pass   : ${rate(results.baseline)} / ${N}  (trials ${START_TRIAL}..${last})`);
console.log(`retry pass      : ${rate(results.retry)} / ${N}  (trials ${START_TRIAL}..${last})`);
console.log(`lift            : +${rate(results.retry) - rate(results.baseline)} / ${N}`);

if (SAVE_RESULTS) {
  // In append mode, don't overwrite summary.json (it was for the prior
  // batch). Write a per-batch file instead so we can aggregate later.
  const summaryPath = APPEND_MODE
    ? `${outRoot}/summary-trials-${START_TRIAL}-${last}.json`
    : `${outRoot}/summary.json`;
  writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        task: argId,
        n: N,
        startTrial: START_TRIAL,
        endTrial: last,
        appendMode: APPEND_MODE,
        baseline: results.baseline,
        retry: results.retry,
        baselinePassRate: `${rate(results.baseline)}/${N}`,
        retryPassRate: `${rate(results.retry)}/${N}`,
      },
      null,
      2
    )
  );
  console.log(`artifacts -> ${outRoot}/`);
}
