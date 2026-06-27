// Failure-driven skill learning for VISUAL computer-use agents.
//
// Ports the EvoSkill idea (turn a failed trajectory into a reusable skill) to the
// computer-use / GUI modality that EvoSkill (coding-agents only) does not cover.
//
// Verified keep-gate: a distilled skill is RETAINED only if the verified retry passes.
// => the skill library is net-positive-by-construction (a skill that didn't fix the
//    task is never persisted).

let _id = 0;
const nextId = () => `skill_${++_id}`;

export async function runWithSkillLearning({ agent, env, goal, store, verify, distill, maxRetries = 1 }) {
  const matched = store.match(goal);

  // 1) Baseline attempt, using any skills already known for this task family.
  let traj = await agent.runTask({ goal, env, skills: matched });
  let passed = await verify(env, traj);

  const result = {
    goal,
    passedBaseline: passed,
    passedAfterSkill: passed,
    attempts: 1,
    skillLearned: null,
  };
  if (passed) return result;

  // 2) Failure -> distill a candidate skill from the failed trajectory.
  //    Uses the per-step `intent` the Computer Use API already returns as signal.
  for (let r = 0; r < maxRetries; r++) {
    if (env.reset) await env.reset();
    const candidate = await distill({ goal, trajectory: traj, priorSkills: matched });

    const retryTraj = await agent.runTask({ goal, env, skills: [...matched, candidate] });
    const retryPassed = await verify(env, retryTraj);
    result.attempts += 1;

    if (retryPassed) {
      // verified keep-gate: only persist a skill that actually fixed the task
      result.skillLearned = store.add({ id: nextId(), ...candidate });
      result.passedAfterSkill = true;
      return result;
    }
    traj = retryTraj; // still failing -> let next round distill from the newer attempt
  }

  return result; // never fixed -> nothing persisted
}
