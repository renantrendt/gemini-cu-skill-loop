// Offline smoke test — exercises every new code path that does NOT need
// a Gemini API key. Run with: node test/smoke.js
//
// Covers:
//   1) denormalize math
//   2) GeminiComputerUse throws cleanly when neither key nor modelFn present
//   3) GeminiComputerUse runs the mock-model path end-to-end (regression)
//   4) Distiller mockFn path
//   5) Verifier deterministic path (no API key required)
//   6) Playwright env loads a file:// page and takes a screenshot

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GeminiComputerUse, denormalize } from '../src/geminiCua.js';
import { createDistiller } from '../src/distiller.js';
import { createVerifier } from '../src/verifier.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('denormalize maps 0..1000 -> 0..size', () => {
  assert.equal(denormalize(0, 1280), 0);
  assert.equal(denormalize(1000, 1280), 1280);
  assert.equal(denormalize(500, 1280), 640);
  assert.equal(denormalize(820, 1000), 820);
});

test('GeminiComputerUse fails cleanly with no key and no modelFn', async () => {
  const cu = new GeminiComputerUse({ apiKey: undefined });
  const env = {
    size: () => ({ width: 1000, height: 1000 }),
    screenshot: async () => 'MOCK',
    execute: async () => {},
  };
  await assert.rejects(
    () => cu.runTask({ goal: 'x', env }),
    /GEMINI_API_KEY missing/
  );
});

test('GeminiComputerUse mock path is unchanged', async () => {
  let clicked = null;
  const env = {
    size: () => ({ width: 1000, height: 1000 }),
    screenshot: async () => 'MOCK',
    execute: async (a) => {
      if (a.type === 'click') clicked = { x: a.x, y: a.y };
    },
  };
  const cu = new GeminiComputerUse({
    modelFn: ({ history }) =>
      history.length === 0
        ? { action: { type: 'click', x: 820, y: 60 }, intent: 'click toolbar' }
        : { action: { type: 'done' }, intent: 'done' },
  });
  const traj = await cu.runTask({ goal: 'export', env });
  assert.equal(traj.length, 2);
  assert.equal(traj[0].action.type, 'click');
  assert.equal(traj[1].action.type, 'done');
  assert.deepEqual(clicked, { x: 820, y: 60 }); // 820 of 1000 -> 820 px
});

test('distiller mockFn path returns shaped skill', async () => {
  const distill = createDistiller({
    modelFn: async ({ goal }) => ({
      tag: 'export',
      title: 'Export is top-right',
      note: 'Look at the toolbar in the top-right for export actions.',
    }),
  });
  const out = await distill({
    goal: 'Export the report',
    trajectory: [
      { step: 0, action: { type: 'click', x: 500, y: 500 }, intent: 'guess center' },
    ],
    priorSkills: [],
  });
  assert.equal(out.tag, 'export');
  assert.ok(out.title.length > 0);
  assert.ok(Array.isArray(out.fromIntents));
});

test('verifier deterministic urlContains works without API key', async () => {
  const fakeEnv = {
    currentUrl: () => 'https://en.wikipedia.org/w/index.php?title=Foo&action=history',
    page: null,
  };
  const verify = createVerifier({
    task: {
      id: 't',
      goal: 'g',
      check: { urlContains: 'action=history' },
      judgeWith: 'none',
    },
    apiKey: undefined,
  });
  assert.equal(await verify(fakeEnv, []), true);

  const fakeBadEnv = { currentUrl: () => 'https://en.wikipedia.org/wiki/Foo', page: null };
  assert.equal(await verify(fakeBadEnv, []), false);
});

test('playwright env opens a file:// page and screenshots', async () => {
  // Lazy import — skip cleanly if Chromium isn't installed yet.
  let createBrowserEnv;
  try {
    ({ createBrowserEnv } = await import('../src/playwrightEnv.js'));
  } catch (e) {
    console.log('  skipped (playwright module not loadable):', e.message);
    return;
  }
  const htmlPath = join(tmpdir(), 'smoke-page.html');
  writeFileSync(
    htmlPath,
    '<!doctype html><title>Smoke</title><h1 id="h">hello</h1>'
  );
  let env;
  try {
    env = await createBrowserEnv({
      headless: true,
      startUrl: 'file://' + htmlPath,
      viewport: { width: 400, height: 300 },
    });
  } catch (e) {
    console.log('  skipped (chromium binary missing — run `npx playwright install chromium`):', e.message);
    return;
  }
  try {
    const sz = env.size();
    assert.equal(sz.width, 400);
    const b64 = await env.screenshot();
    assert.ok(typeof b64 === 'string' && b64.length > 100);
    assert.ok(env.currentUrl().startsWith('file://'));
  } finally {
    await env.close();
  }
});

let pass = 0, fail = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log('ok   ', name);
    pass++;
  } catch (e) {
    console.log('FAIL ', name);
    console.log('     ', e?.stack ?? e);
    fail++;
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
