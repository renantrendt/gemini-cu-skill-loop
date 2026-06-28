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
  {
    // Harder family: the target lives inside Wikipedia's collapsed
    // sidebar "Tools" menu. CU agents commonly fail because the link
    // is hidden behind a disclosure widget; the skill teaches "open the
    // Tools menu in the left sidebar first".
    id: 'wiki-cite-page',
    family: 'wiki-tools-sidebar',
    goal: "On the Wikipedia article for 'Computer mouse', open the 'Cite this page' tool to get a citation for this article.",
    startUrl: 'https://en.wikipedia.org/wiki/Computer_mouse',
    check: { urlContains: 'Special:CiteThisPage' },
    judgeWith: 'none',
    heldOutOf: null,
  },
  {
    id: 'wiki-cite-page-heldout',
    family: 'wiki-tools-sidebar',
    goal: "On the Wikipedia article for 'Bicycle', open the 'Cite this page' tool to get a citation for this article.",
    startUrl: 'https://en.wikipedia.org/wiki/Bicycle',
    check: { urlContains: 'Special:CiteThisPage' },
    judgeWith: 'none',
    heldOutOf: 'wiki-cite-page',
  },
  {
    // Hidden-filter task: agents often default to the visible "Issues"
    // tab and forget that the closed-only view requires editing the
    // search box query (or clicking the small 'Closed' counter link).
    id: 'gh-closed-issues',
    family: 'gh-filter',
    goal: "On the GitHub repo page for microsoft/playwright, filter the issues list to show ONLY closed issues.",
    startUrl: 'https://github.com/microsoft/playwright/issues',
    check: {
      urlMatches: /(is|state)(%3A|:|=)closed/i,
    },
    judgeWith: 'none',
    heldOutOf: null,
  },
  {
    id: 'gh-closed-issues-heldout',
    family: 'gh-filter',
    goal: "On the GitHub repo page for vercel/next.js, filter the issues list to show ONLY closed issues.",
    startUrl: 'https://github.com/vercel/next.js/issues',
    check: {
      urlMatches: /(is|state)(%3A|:|=)closed/i,
    },
    judgeWith: 'none',
    heldOutOf: 'gh-closed-issues',
  },
  {
    // Multi-filter sidebar task. CU agents typically struggle here:
    // many similar-looking facet checkboxes, the relevant ones aren't
    // visible without scrolling the sidebar, and the URL query syntax
    // is non-obvious. Real failure mode reported across CU benchmarks.
    id: 'hf-models-filter',
    family: 'hf-filter',
    goal: "On Hugging Face's models page, apply BOTH filters: task='text-generation' AND library='transformers'. Both filter facets must be selected.",
    startUrl: 'https://huggingface.co/models',
    check: {
      urlMatches: /pipeline_tag=text-generation/,
      custom: async (page) => /library=transformers/.test(page.url()),
    },
    judgeWith: 'none',
    heldOutOf: null,
  },
  {
    id: 'hf-models-filter-heldout',
    family: 'hf-filter',
    goal: "On Hugging Face's models page, apply BOTH filters: task='image-classification' AND library='pytorch'. Both filter facets must be selected.",
    startUrl: 'https://huggingface.co/models',
    check: {
      urlMatches: /pipeline_tag=image-classification/,
      custom: async (page) => /library=pytorch/.test(page.url()),
    },
    judgeWith: 'none',
    heldOutOf: 'hf-models-filter',
  },
  {
    // The 'Move' option lives inside a small 'More' (kebab/dropdown)
    // menu next to the View history tab. Agents often miss it because
    // it isn't visible without first opening the disclosure widget.
    // Documented as a representative failure pattern in CUA benchmarks
    // (hidden menus / disclosure widgets).
    id: 'wiki-more-move',
    family: 'wiki-more-menu',
    goal: "On the Wikipedia article for 'Computer mouse', open the 'Move' page option (used to rename the article). This option lives in the 'More' dropdown menu near the View history tab.",
    startUrl: 'https://en.wikipedia.org/wiki/Computer_mouse',
    check: { urlContains: 'Special:MovePage' },
    judgeWith: 'none',
    heldOutOf: null,
  },
  {
    id: 'wiki-more-move-heldout',
    family: 'wiki-more-menu',
    goal: "On the Wikipedia article for 'Bicycle', open the 'Move' page option (used to rename the article). This option lives in the 'More' dropdown menu near the View history tab.",
    startUrl: 'https://en.wikipedia.org/wiki/Bicycle',
    check: { urlContains: 'Special:MovePage' },
    judgeWith: 'none',
    heldOutOf: 'wiki-more-move',
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
