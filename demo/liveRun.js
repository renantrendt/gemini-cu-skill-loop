// Live demo of the Gemini CU skill loop against a real browser + real model.
//
// Requires:
//   - GEMINI_API_KEY in env (https://aistudio.google.com/api-keys)
//   - `npm install` and `npx playwright install chromium` (one-time)
//
// Usage:
//   GEMINI_API_KEY=... node demo/liveRun.js                  # all primary tasks
//   GEMINI_API_KEY=... node demo/liveRun.js wiki-edit-tab    # one task
//   GEMINI_API_KEY=... HEADLESS=1 node demo/liveRun.js       # headless
//   BASELINE_ONLY=1 node demo/liveRun.js                     # skip skill-loop;
//                                                              fast survey of which
//                                                              tasks the bare model
//                                                              already passes
//   TRACE=1 node demo/liveRun.js                             # write final screenshots
//                                                              and distilled-skill info
//                                                              under ./traces/
//
// What it does:
//   1) For each task, attempt with no skills (baseline).
//   2) On failure, distill a skill from the failed trajectory.
//   3) Retry; persist the skill ONLY if the verified retry passes.
//   4) If the family has a held-out task, run it with the learned skill
//      to check that the skill generalises (not just memorises).

import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { GeminiComputerUse } from '../src/geminiCua.js';
import { SkillStore } from '../src/skillStore.js';
import { runWithSkillLearning } from '../src/skillLoop.js';
import { createBrowserEnv } from '../src/playwrightEnv.js';
import { createDistiller } from '../src/distiller.js';
import { createVerifier } from '../src/verifier.js';
import { TASKS, primaryTasks, heldOutFor, getTask } from '../src/tasks.js';

const TRACE = !!process.env.TRACE;
if (TRACE && !existsSync('./traces')) mkdirSync('./traces');

// SAVE_RESULTS writes a clean, judge-facing artifact bundle per task
// at demo/results/<task-id>/ so the run can be audited end-to-end:
//   task.json            - what we asked the agent to do + how we verified
//   baseline.json        - every step of the bare-model attempt
//   baseline-final.png   - what the page looked like when baseline failed
//   distilled-skill.json - the skill the distiller wrote from the failure
//   retry.json           - every step of the with-skill retry
//   retry-final.png      - what the page looked like when retry passed
//   heldout.json         - each held-out variant's trajectory
//   heldout-final-*.png  - their final screenshots
//   summary.json         - pass/fail flags + counts
const SAVE_RESULTS = !!process.env.SAVE_RESULTS;
const resultsDirFor = (taskId) => `./demo/results/${taskId}`;
const saveJSON = (path, data) =>
  writeFileSync(path, JSON.stringify(data, null, 2));
const savePNG = (path, b64) => writeFileSync(path, Buffer.from(b64, 'base64'));

if (!process.env.GEMINI_API_KEY) {
  console.error(
    'GEMINI_API_KEY not set. Get one at https://aistudio.google.com/api-keys'
  );
  process.exit(1);
}

const HEADLESS = !!process.env.HEADLESS;
const BASELINE_ONLY = !!process.env.BASELINE_ONLY;
const argTaskId = process.argv[2];

const targets = argTaskId
  ? [getTask(argTaskId)].filter((t) => !t.heldOutOf)
  : primaryTasks();

const store = new SkillStore({ path: './skills.json' });
const tracedDistiller = createDistiller();
const distill = async (args) => {
  const skill = await tracedDistiller(args);
  if (TRACE) console.log('  distilled:', skill.tag, '-', skill.title);
  return skill;
};
const agent = new GeminiComputerUse({ environment: 'browser' });

const results = [];

for (const task of targets) {
  console.log(`\n=== ${task.id}  (family=${task.family}) ===`);
  console.log(`goal: ${task.goal}`);

  const env = await createBrowserEnv({
    headless: HEADLESS,
    startUrl: task.startUrl,
  });
  const verify = createVerifier({ task });

  // Per-task artifact dir (wiped fresh on each run).
  const outDir = resultsDirFor(task.id);
  if (SAVE_RESULTS) {
    if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    saveJSON(`${outDir}/task.json`, {
      id: task.id,
      family: task.family,
      goal: task.goal,
      startUrl: task.startUrl,
      check: serialiseCheck(task.check),
      heldOutOf: task.heldOutOf,
    });
  }

  try {
    let res;
    if (BASELINE_ONLY) {
      // Cheap survey mode: one bare-model attempt, no distillation, no retry.
      const traj = await agent.runTask({ goal: task.goal, env, skills: [] });
      const passed = await verify(env, traj);
      res = { passedBaseline: passed, passedAfterSkill: passed, attempts: 1, skillLearned: null };
      console.log(`baseline=${passed} (BASELINE_ONLY)`);
    } else {
      res = await runWithSkillLearning({
        agent,
        env,
        goal: task.goal,
        store,
        verify,
        distill,
        maxRetries: 1,
      });
      console.log(
        `baseline=${res.passedBaseline} afterSkill=${res.passedAfterSkill} attempts=${res.attempts}`
      );
    }
    const finalUrl = env.currentUrl ? env.currentUrl() : '?';
    const finalShot = await env.screenshot();
    if (TRACE) {
      console.log('  final URL:', finalUrl);
      const shotPath = `./traces/${task.id}-final-${Date.now()}.png`;
      savePNG(shotPath, finalShot);
      console.log('  screenshot ->', shotPath);
    }

    // Save the structured artifact bundle. We save *after* the run so
    // the trajectories captured in `res` are complete.
    if (SAVE_RESULTS) {
      if (BASELINE_ONLY) {
        saveJSON(`${outDir}/baseline.json`, {
          passed: res.passedBaseline,
          finalUrl,
          trajectory: null, // baseline-only mode doesn't expose the inner traj
          note: 'BASELINE_ONLY survey mode; trajectories not captured.',
        });
      } else {
        saveJSON(`${outDir}/baseline.json`, {
          passed: res.passedBaseline,
          trajectory: res.baselineTrajectory,
        });
        if (res.distilledCandidates?.length) {
          res.distilledCandidates.forEach((c, i) => {
            const name =
              res.distilledCandidates.length === 1
                ? 'distilled-skill.json'
                : `distilled-skill-${i}.json`;
            saveJSON(`${outDir}/${name}`, c);
          });
        }
        if (res.retryTrajectories?.length) {
          res.retryTrajectories.forEach((t, i) => {
            const name =
              res.retryTrajectories.length === 1
                ? 'retry.json'
                : `retry-${i}.json`;
            saveJSON(`${outDir}/${name}`, {
              passed:
                i === res.retryTrajectories.length - 1
                  ? res.passedAfterSkill
                  : false,
              trajectory: t,
            });
          });
        }
      }
      savePNG(
        `${outDir}/${res.passedAfterSkill ? 'retry-final.png' : 'baseline-final.png'}`,
        finalShot
      );
    }

    if (res.skillLearned) {
      console.log(`learned: [${res.skillLearned.tag}] ${res.skillLearned.title}`);
    }
    results.push({ task: task.id, ...res });

    // Held-out variants — only if a skill was actually learned and we
    // aren't in baseline-only mode. heldOutFor returns an array (a
    // family may have a same-site AND a cross-site held-out).
    if (!BASELINE_ONLY && res.skillLearned) {
      const heldList = heldOutFor(task.id);
      for (const held of heldList) {
        console.log(`-- held-out: ${held.id} --`);
        const env2 = await createBrowserEnv({
          headless: HEADLESS,
          startUrl: held.startUrl,
        });
        const verify2 = createVerifier({ task: held });
        try {
          const traj = await agent.runTask({
            goal: held.goal,
            env: env2,
            skills: store.match(held.goal),
          });
          const passed = await verify2(env2, traj);
          console.log(`held-out passed=${passed}`);
          results.push({ task: held.id, heldOutPassed: passed });
          if (SAVE_RESULTS) {
            saveJSON(`${outDir}/heldout-${held.id}.json`, {
              taskId: held.id,
              goal: held.goal,
              startUrl: held.startUrl,
              passed,
              trajectory: traj,
              finalUrl: env2.currentUrl ? env2.currentUrl() : '?',
            });
            savePNG(`${outDir}/heldout-${held.id}-final.png`, await env2.screenshot());
          }
        } finally {
          await env2.close();
        }
      }
    }

    if (SAVE_RESULTS) {
      saveJSON(`${outDir}/summary.json`, {
        taskId: task.id,
        family: task.family,
        passedBaseline: res.passedBaseline,
        passedAfterSkill: res.passedAfterSkill,
        attempts: res.attempts,
        skillLearned: res.skillLearned,
        heldOutResults: results
          .filter((r) => r.task !== task.id && r.heldOutPassed !== undefined)
          .map((r) => ({ task: r.task, passed: r.heldOutPassed })),
      });
      console.log(`  artifacts -> ${outDir}/`);
    }
  } catch (e) {
    console.error(`task ${task.id} errored:`, e?.message ?? e);
    results.push({ task: task.id, error: String(e?.message ?? e) });
  } finally {
    await env.close();
  }
}

console.log('\n=== summary ===');
console.table(
  results.map((r) => ({
    task: r.task,
    baseline: r.passedBaseline,
    afterSkill: r.passedAfterSkill,
    heldOut: r.heldOutPassed,
    error: r.error?.slice(0, 60),
  }))
);

console.log(`\nskills in store: ${store.all().length}`);
console.log('skills written to ./skills.json');

// Helper: turn task.check into something JSON-serialisable (functions/regex
// are nuked but their string form is preserved for the audit trail).
function serialiseCheck(check) {
  if (!check) return null;
  const out = {};
  for (const [k, v] of Object.entries(check)) {
    if (typeof v === 'function') out[k] = '<function>';
    else if (v instanceof RegExp) out[k] = v.toString();
    else out[k] = v;
  }
  return out;
}
