#!/usr/bin/env node
// Generate a single human-readable CASE.md per result bundle, stitching
// together: task spec → baseline trajectory + judge reasoning → distilled
// skill (+ distiller chain-of-thought if recaptured) → retry trajectory +
// judge reasoning → held-out outcomes → reproducibility summary.
//
// Usage:
//   node scripts/case-study.js wv-ArXiv--23
//   node scripts/case-study.js wv-Apple--0
//
// Reads from demo/results/<bundle>/ and writes demo/results/<bundle>/CASE.md.
// No API calls. Idempotent.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const bundleArg = process.argv[2];
if (!bundleArg) {
  console.error('usage: node scripts/case-study.js <bundle-name>');
  console.error('e.g.  node scripts/case-study.js wv-ArXiv--23');
  process.exit(1);
}
const dir = `demo/results/${bundleArg}`;
if (!existsSync(dir)) {
  console.error(`no bundle at ${dir}`);
  process.exit(1);
}

const readJSON = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const readText = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);

const task = readJSON(join(dir, 'task.json'));
const baseline = readJSON(join(dir, 'baseline.json'));
// retry/skill files differ between MAX_RETRIES=1 (retry.json, distilled-skill.json)
// and MAX_RETRIES>1 (retry-1.json, distilled-skill-1.json). Pick whichever.
const retry =
  readJSON(join(dir, 'retry-1.json')) ||
  readJSON(join(dir, 'retry.json'));
const skill =
  readJSON(join(dir, 'distilled-skill-1.json')) ||
  readJSON(join(dir, 'distilled-skill.json'));
const distillerCot = readText(join(dir, 'distillation-reasoning.txt'));

// Held-outs are subdirectories like heldout-<TaskId>/result.json
const heldouts = readdirSync(dir)
  .filter((n) => n.startsWith('heldout-') && statSync(join(dir, n)).isDirectory())
  .map((n) => ({ id: n.replace(/^heldout-/, ''), result: readJSON(join(dir, n, 'result.json')) }))
  .filter((h) => h.result);

// Reproducibility study lives in a sibling repro-* bundle (one per task)
const reproDir = `demo/results/repro-${task?.id ?? ''}`;
const repro = existsSync(`${reproDir}/summary.json`)
  ? readJSON(`${reproDir}/summary.json`)
  : null;

function fmtTrajectory(trajectory) {
  if (!trajectory || !trajectory.length) return '_(no trajectory recorded)_';
  return trajectory
    .map((t) => {
      const a = t.action ?? {};
      const args = Object.entries(a)
        .filter(([k]) => k !== 'type')
        .map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 40)}`)
        .join(' ');
      const intent = (t.intent ?? '').replace(/\n+/g, ' ').slice(0, 140);
      return `${String(t.step).padStart(2, ' ')}. \`${a.type}\`${args ? ' `' + args + '`' : ''} — ${intent}`;
    })
    .join('\n');
}

function fmtVerdict(passed) {
  return passed ? '✅ **SUCCESS**' : '❌ **NOT SUCCESS**';
}

const lines = [];
lines.push(`# Case study: ${task?.id ?? bundleArg}`);
lines.push('');
lines.push(
  `_Auto-generated from the artifact bundle by_ \`scripts/case-study.js\`. _Edit the script, not this file._`
);
lines.push('');
lines.push('## Task');
lines.push('');
lines.push(`- **ID**: \`${task?.id}\``);
lines.push(`- **Site**: ${task?.web ?? task?.startUrl ?? '?'}`);
if (task?.family) lines.push(`- **Family**: \`${task.family}\``);
lines.push('- **Verbatim prompt** (from WebVoyager):');
lines.push('');
lines.push(`  > ${task?.ques ?? task?.goal ?? '(unknown)'}`);
lines.push('');

// --- Baseline ---
if (baseline) {
  lines.push('## Baseline (no skill)');
  lines.push('');
  lines.push(`- Verdict: ${fmtVerdict(baseline.passed)}`);
  if (baseline.finalUrl) lines.push(`- Final URL: \`${baseline.finalUrl}\``);
  if (baseline.finalAnswer != null)
    lines.push(`- Final answer: ${JSON.stringify(baseline.finalAnswer).slice(0, 300)}`);
  lines.push('');
  if (baseline.judge?.reasoning) {
    lines.push('### Judge reasoning');
    lines.push('');
    lines.push('> ' + baseline.judge.reasoning.trim().split('\n').join('\n> '));
    lines.push('');
  }
  if (baseline.triage) {
    lines.push(
      `### Triage: \`real=${baseline.triage.real}\` ${baseline.triage.reason ? '(' + baseline.triage.reason + ')' : ''}`
    );
    lines.push('');
  }
  const traj = baseline.trajectory ?? baseline.traj;
  if (traj) {
    lines.push(`### Agent trajectory (${traj.length} steps)`);
    lines.push('');
    lines.push(fmtTrajectory(traj));
    lines.push('');
  }
  lines.push(
    '![baseline final state](./baseline-final.png)'
  );
  lines.push('');
}

// --- Distilled skill ---
if (skill) {
  lines.push('## Distilled skill');
  lines.push('');
  lines.push(`- **Tag**: \`${skill.tag}\``);
  lines.push(`- **Title**: ${skill.title}`);
  lines.push('- **Note**:');
  lines.push('');
  lines.push('  > ' + (skill.note ?? '').trim().split('\n').join('\n  > '));
  lines.push('');
  if (distillerCot) {
    lines.push('### Distiller chain-of-thought (recaptured)');
    lines.push('');
    lines.push(
      '_The model\'s pre-JSON reasoning, saved by_ `scripts/recapture-distillation.js`. _Same baseline trajectory, same prompt — re-run with the JSON-only constraint dropped so we could keep the prose._'
    );
    lines.push('');
    lines.push('```');
    lines.push(distillerCot.trim());
    lines.push('```');
    lines.push('');
  }
}

// --- Retry ---
if (retry) {
  lines.push('## Retry (with skill in context)');
  lines.push('');
  lines.push(`- Verdict: ${fmtVerdict(retry.passed)}`);
  if (retry.finalUrl) lines.push(`- Final URL: \`${retry.finalUrl}\``);
  if (retry.finalAnswer != null)
    lines.push(`- Final answer: ${JSON.stringify(retry.finalAnswer).slice(0, 300)}`);
  lines.push('');
  if (retry.judge?.reasoning) {
    lines.push('### Judge reasoning');
    lines.push('');
    lines.push('> ' + retry.judge.reasoning.trim().split('\n').join('\n> '));
    lines.push('');
  }
  const traj = retry.trajectory ?? retry.traj;
  if (traj) {
    lines.push(`### Agent trajectory (${traj.length} steps)`);
    lines.push('');
    lines.push(fmtTrajectory(traj));
    lines.push('');
  }
  // pick whichever final-screenshot file exists
  const screenshot = existsSync(join(dir, 'retry-final-1.png'))
    ? 'retry-final-1.png'
    : existsSync(join(dir, 'retry-final.png'))
    ? 'retry-final.png'
    : null;
  if (screenshot) {
    lines.push(`![retry final state](./${screenshot})`);
    lines.push('');
  }
}

// --- Held-outs ---
if (heldouts.length) {
  lines.push('## Held-out generalisation');
  lines.push('');
  lines.push(
    'The kept skill (same JSON, no modification) was loaded into context for these *unseen* task instances of the same template.'
  );
  lines.push('');
  for (const h of heldouts) {
    const r = h.result;
    lines.push(`### \`${h.id}\` — ${fmtVerdict(r.passed)}`);
    lines.push('');
    if (r.goal || r.question)
      lines.push(`- Goal: ${JSON.stringify(r.goal ?? r.question)}`);
    if (r.finalUrl) lines.push(`- Final URL: \`${r.finalUrl}\``);
    if (r.finalAnswer != null)
      lines.push(`- Final answer: ${JSON.stringify(r.finalAnswer).slice(0, 240)}`);
    if (r.judge?.reasoning) {
      lines.push('');
      lines.push('Judge:');
      lines.push('');
      lines.push('> ' + r.judge.reasoning.trim().split('\n').join('\n> '));
    }
    lines.push('');
  }
}

// --- Reproducibility ---
if (repro) {
  lines.push('## Reproducibility');
  lines.push('');
  lines.push(`- N per condition: **${repro.n}**`);
  lines.push(`- Baseline pass rate: **${repro.baselinePassRate}**`);
  lines.push(`- Retry pass rate:    **${repro.retryPassRate}**`);
  lines.push('');
  lines.push('| Condition | Trials | Pass |');
  lines.push('|---|---|---|');
  const fmtRow = (label, trials) =>
    `| ${label} | ${trials.map((t) => (t.passed ? '✅' : '❌') + (t.steps ? ` (${t.steps})` : '')).join(' · ')} | **${trials.filter((t) => t.passed).length}/${trials.length}** |`;
  lines.push(fmtRow('Baseline (no skill)', repro.baseline));
  lines.push(fmtRow('Retry (with skill)', repro.retry));
  lines.push('');
  lines.push(`Per-trial details: [\`demo/results/repro-${task.id}/\`](../repro-${task.id}/)`);
  lines.push('');
}

lines.push('---');
lines.push('');
lines.push(
  `_Re-generate this file with:_ \`node scripts/case-study.js ${bundleArg}\``
);
lines.push('');

const out = lines.join('\n');
const outPath = join(dir, 'CASE.md');
writeFileSync(outPath, out);
console.log(`wrote ${outPath} (${out.length} bytes)`);
