// Curated browser-task fixtures for the skill loop.
//
// Selection criteria:
//   - public, no auth required
//   - stable target sites (well-known sources, slow-changing UIs)
//   - deterministic verifier (URL or DOM predicate) wherever possible
//   - non-trivial enough that a vanilla CU agent has a real failure mode,
//     so the loop has actual work to do
//
// Held-out variants (for the "doesn't just memorise" check):
//   each task family has a {primary, heldOut} pair. The agent learns a
//   skill on `primary` after a failure, then `heldOut` validates that
//   the skill *generalises* rather than just remembering specific coords.

export const TASKS = [
  {
    id: 'wiki-edit-tab',
    family: 'wiki-edit',
    goal: "On the Wikipedia article for 'Computer mouse', open the page's edit-history view (the 'View history' tab).",
    startUrl: 'https://en.wikipedia.org/wiki/Computer_mouse',
    check: { urlContains: 'action=history' },
    judgeWith: 'none',
    heldOutOf: null,
  },
  {
    id: 'wiki-edit-tab-heldout',
    family: 'wiki-edit',
    goal: "On the Wikipedia article for 'Bicycle', open the page's edit-history view (the 'View history' tab).",
    startUrl: 'https://en.wikipedia.org/wiki/Bicycle',
    check: { urlContains: 'action=history' },
    judgeWith: 'none',
    heldOutOf: 'wiki-edit-tab',
  },
  {
    id: 'arxiv-html-view',
    family: 'arxiv-html',
    goal: "On the arXiv abstract page for paper 2305.10601, open the HTML rendering of the paper.",
    startUrl: 'https://arxiv.org/abs/2305.10601',
    check: { urlContains: 'arxiv.org/html/2305.10601' },
    judgeWith: 'none',
    heldOutOf: null,
  },
  {
    id: 'arxiv-html-view-heldout',
    family: 'arxiv-html',
    goal: "On the arXiv abstract page for paper 1706.03762, open the HTML rendering of the paper.",
    startUrl: 'https://arxiv.org/abs/1706.03762',
    check: { urlContains: 'arxiv.org/html/1706.03762' },
    judgeWith: 'none',
    heldOutOf: 'arxiv-html-view',
  },
  {
    id: 'gh-stargazers',
    family: 'gh-stargazers',
    goal: "On the GitHub repo page for sentient-agi/EvoSkill, open the list of stargazers.",
    startUrl: 'https://github.com/sentient-agi/EvoSkill',
    check: { urlContains: '/stargazers' },
    judgeWith: 'none',
    heldOutOf: null,
  },
  {
    id: 'gh-stargazers-heldout',
    family: 'gh-stargazers',
    goal: "On the GitHub repo page for microsoft/playwright, open the list of stargazers.",
    startUrl: 'https://github.com/microsoft/playwright',
    check: { urlContains: '/stargazers' },
    judgeWith: 'none',
    heldOutOf: 'gh-stargazers',
  },
];

export function getTask(id) {
  const t = TASKS.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown task id: ${id}`);
  return t;
}

export function primaryTasks() {
  return TASKS.filter((t) => !t.heldOutOf);
}

export function heldOutFor(id) {
  return TASKS.find((t) => t.heldOutOf === id) ?? null;
}
