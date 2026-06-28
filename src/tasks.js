// Curated browser-task fixtures for the skill loop.
//
// Selection criteria:
//   - public, no auth required
//   - stable target sites (well-known sources, slow-changing UIs)
//   - deterministic verifier (URL or DOM predicate) wherever possible
//   - GOALS ARE OUTCOME-ONLY: never name the UI element, the tab, the
//     menu, or the URL query syntax. Naming any of those is answer
//     leakage and inflates the pass rate.
//
// Held-out variants (for the "doesn't just memorise" check):
//   each task family has a {primary, heldOut} pair. heldOut runs on a
//   DIFFERENT page (and where possible a different site) so a learned
//   skill must generalise rather than memorise pixel coords or specific
//   labels.

export const TASKS = [
  {
    // hinted v1 was: "...open the page's edit-history view (the 'View history' tab)."
    id: 'wiki-edit-tab',
    family: 'wiki-edit',
    goal: "I'm on a Wikipedia article. I want to see the full list of past edits — who edited this article and when. Take me there.",
    startUrl: 'https://en.wikipedia.org/wiki/Computer_mouse',
    check: { urlContains: 'action=history' },
    judgeWith: 'none',
    heldOutOf: null,
  },
  {
    id: 'wiki-edit-tab-heldout',
    family: 'wiki-edit',
    goal: "I'm on a Wikipedia article. I want to see the full list of past edits — who edited this article and when. Take me there.",
    startUrl: 'https://en.wikipedia.org/wiki/Bicycle',
    check: { urlContains: 'action=history' },
    judgeWith: 'none',
    heldOutOf: 'wiki-edit-tab',
  },
  {
    // Cross-site held-out: a different MediaWiki install (mediawiki.org
    // itself). Same engine, different content and slightly different
    // theming. If the skill is "use the View history tab" the skill
    // still works; if the skill memorised pixel coords on en.wikipedia
    // it won't. This is the stronger generalisation argument.
    id: 'wiki-edit-tab-crosssite',
    family: 'wiki-edit',
    goal: "I'm on a Wikipedia-style article. I want to see the full list of past edits — who edited this article and when. Take me there.",
    startUrl: 'https://www.mediawiki.org/wiki/MediaWiki',
    check: { urlContains: 'action=history' },
    judgeWith: 'none',
    heldOutOf: 'wiki-edit-tab',
  },
  {
    // hinted v1 was: "...open the HTML rendering of the paper."
    id: 'arxiv-html-view',
    family: 'arxiv-html',
    goal: "I'm on an arXiv paper page. I'd rather read this paper as a webpage than as a PDF. Take me to the version I can read in the browser.",
    startUrl: 'https://arxiv.org/abs/2305.10601',
    check: { urlContains: 'arxiv.org/html/2305.10601' },
    judgeWith: 'none',
    heldOutOf: null,
  },
  {
    id: 'arxiv-html-view-heldout',
    family: 'arxiv-html',
    goal: "I'm on an arXiv paper page. I'd rather read this paper as a webpage than as a PDF. Take me to the version I can read in the browser.",
    startUrl: 'https://arxiv.org/abs/1706.03762',
    check: { urlContains: 'arxiv.org/html/1706.03762' },
    judgeWith: 'none',
    heldOutOf: 'arxiv-html-view',
  },
  {
    // hinted v1 was: "...open the list of stargazers."
    id: 'gh-stargazers',
    family: 'gh-stargazers',
    goal: "I'm on a GitHub repository page. I want to see every user who's marked this repo as a favourite. Take me to that list.",
    startUrl: 'https://github.com/sentient-agi/EvoSkill',
    check: { urlContains: '/stargazers' },
    judgeWith: 'none',
    heldOutOf: null,
  },
  {
    id: 'gh-stargazers-heldout',
    family: 'gh-stargazers',
    goal: "I'm on a GitHub repository page. I want to see every user who's marked this repo as a favourite. Take me to that list.",
    startUrl: 'https://github.com/microsoft/playwright',
    check: { urlContains: '/stargazers' },
    judgeWith: 'none',
    heldOutOf: 'gh-stargazers',
  },
  {
    // hinted v1 was: "...open the 'Cite this page' tool to get a citation."
    id: 'wiki-cite-page',
    family: 'wiki-tools-sidebar',
    goal: "I'm on a Wikipedia article and I want to reference it in a bibliography for an essay. Find me a properly-formatted citation I can paste into my paper.",
    startUrl: 'https://en.wikipedia.org/wiki/Computer_mouse',
    check: { urlContains: 'Special:CiteThisPage' },
    judgeWith: 'none',
    heldOutOf: null,
  },
  {
    id: 'wiki-cite-page-heldout',
    family: 'wiki-tools-sidebar',
    goal: "I'm on a Wikipedia article and I want to reference it in a bibliography for an essay. Find me a properly-formatted citation I can paste into my paper.",
    startUrl: 'https://en.wikipedia.org/wiki/Bicycle',
    check: { urlContains: 'Special:CiteThisPage' },
    judgeWith: 'none',
    heldOutOf: 'wiki-cite-page',
  },
  {
    // hinted v1 was: "...filter the issues list to show ONLY closed issues."
    id: 'gh-closed-issues',
    family: 'gh-filter',
    goal: "I'm looking at a GitHub repository's issue list. I only want to see the issues that have already been resolved — not the ones still open. Update the view to show me just those.",
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
    goal: "I'm looking at a GitHub repository's issue list. I only want to see the issues that have already been resolved — not the ones still open. Update the view to show me just those.",
    startUrl: 'https://github.com/vercel/next.js/issues',
    check: {
      urlMatches: /(is|state)(%3A|:|=)closed/i,
    },
    judgeWith: 'none',
    heldOutOf: 'gh-closed-issues',
  },
  {
    // hinted v1 was: "...apply BOTH filters: task='text-generation' AND library='transformers'."
    id: 'hf-models-filter',
    family: 'hf-filter',
    goal: "I'm on Hugging Face. I want to browse only the models that can generate text and that I can use with the Transformers Python library. Narrow the list to just those.",
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
    goal: "I'm on Hugging Face. I want to browse only the models that can classify images and that I can use with the PyTorch library. Narrow the list to just those.",
    startUrl: 'https://huggingface.co/models',
    check: {
      urlMatches: /pipeline_tag=image-classification/,
      custom: async (page) => /library=pytorch/.test(page.url()),
    },
    judgeWith: 'none',
    heldOutOf: 'hf-models-filter',
  },
  {
    // hinted v1 was: "...open the 'Move' page option (used to rename the article).
    //                  This option lives in the 'More' dropdown menu near the View history tab."
    // The v1 hint named both the option AND its menu location — maximal leakage.
    id: 'wiki-more-move',
    family: 'wiki-more-menu',
    goal: "I'm on a Wikipedia article and I think its title is wrong. I want to change the article's title. Start the process for me.",
    startUrl: 'https://en.wikipedia.org/wiki/Computer_mouse',
    check: { urlContains: 'Special:MovePage' },
    judgeWith: 'none',
    heldOutOf: null,
  },
  {
    id: 'wiki-more-move-heldout',
    family: 'wiki-more-menu',
    goal: "I'm on a Wikipedia article and I think its title is wrong. I want to change the article's title. Start the process for me.",
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
  // Returns ALL held-out variants for a given primary task (same-site
  // plus the cross-site one where present).
  return TASKS.filter((t) => t.heldOutOf === id);
}
