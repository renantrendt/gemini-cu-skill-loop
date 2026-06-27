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
//
// What it does:
//   1) For each task, attempt with no skills (baseline).
//   2) On failure, distill a skill from the failed trajectory.
//   3) Retry; persist the skill ONLY if the verified retry passes.
//   4) If the family has a held-out task, run it with the learned skill
//      to check that the skill generalises (not just memorises).

import { GeminiComputerUse } from '../src/geminiCua.js';
import { SkillStore } from '../src/skillStore.js';
import { runWithSkillLearning } from '../src/skillLoop.js';
import { createBrowserEnv } from '../src/playwrightEnv.js';
import { createDistiller } from '../src/distiller.js';
import { createVerifier } from '../src/verifier.js';
import { TASKS, primaryTasks, heldOutFor, getTask } from '../src/tasks.js';

if (!process.env.GEMINI_API_KEY) {
  console.error(
    'GEMINI_API_KEY not set. Get one at https://aistudio.google.com/api-keys'
  );
  process.exit(1);
}

const HEADLESS = !!process.env.HEADLESS;
const argTaskId = process.argv[2];

const targets = argTaskId
  ? [getTask(argTaskId)].filter((t) => !t.heldOutOf)
  : primaryTasks();

const store = new SkillStore({ path: './skills.json' });
const distill = createDistiller();
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

  try {
    const res = await runWithSkillLearning({
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
    if (res.skillLearned) {
      console.log(`learned: [${res.skillLearned.tag}] ${res.skillLearned.title}`);
    }
    results.push({ task: task.id, ...res });

    // Held-out variant — only if a skill was actually learned.
    const held = heldOutFor(task.id);
    if (held && res.skillLearned) {
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
      } finally {
        await env2.close();
      }
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
