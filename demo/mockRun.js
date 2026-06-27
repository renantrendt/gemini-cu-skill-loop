// Runnable WITHOUT a Gemini key or browser — proves the loop + skill control flow.
// Replace `mockModel` with the real Gemini CU call and `makeEnv` with a Playwright
// browser at the venue; the skill loop is unchanged.

import { GeminiComputerUse } from '../src/geminiCua.js';
import { SkillStore } from '../src/skillStore.js';
import { runWithSkillLearning } from '../src/skillLoop.js';

// Mock UI: task = click the real "Export" button (top-right toolbar, ~820,60 on a 1000-grid).
function makeEnv() {
  let clicked = null;
  return {
    size: () => ({ width: 1000, height: 1000 }),
    screenshot: async () => 'data:image/png;base64,MOCK',
    execute: async (a) => { if (a.type === 'click') clicked = { x: a.x, y: a.y }; },
    reset: async () => { clicked = null; },
    succeeded: () => !!clicked && Math.abs(clicked.x - 820) < 30 && Math.abs(clicked.y - 60) < 30,
  };
}

// Mock model: WITHOUT the learned skill it mis-clicks center (a real CU failure mode);
// WITH the skill in context it clicks the real Export button. Emits an `intent` per step.
function mockModel({ skills, history }) {
  if (history.length >= 1) return { action: { type: 'done' }, intent: 'Task complete' };
  const hasSkill = skills.some((s) => s.tag === 'export');
  return hasSkill
    ? { action: { type: 'click', x: 820, y: 60 }, intent: 'Click Export in the top-right toolbar (learned skill)' }
    : { action: { type: 'click', x: 500, y: 500 }, intent: 'Click the center control that looks like export' };
}

const verify = async (env) => env.succeeded();

const distill = async ({ trajectory }) => ({
  tag: 'export',
  title: 'Export lives in the top-right toolbar',
  note: 'For "export" tasks the control is in the top-right toolbar (~x=820,y=60 on a 1000-grid), not center screen.',
  fromIntents: trajectory.map((t) => t.intent),
});

const agent = new GeminiComputerUse({ environment: 'browser', modelFn: mockModel });
const store = new SkillStore(); // in-memory

const res = await runWithSkillLearning({ agent, env: makeEnv(), goal: 'Export the current report', store, verify, distill });

console.log('--- Gemini CU Skill-Loop (mock model, no API key) ---');
console.log('baseline passed    :', res.passedBaseline);
console.log('passed after skill :', res.passedAfterSkill);
console.log('attempts           :', res.attempts);
console.log('skill learned      :', res.skillLearned?.title ?? null);
console.log('skills in store    :', store.all().length);
