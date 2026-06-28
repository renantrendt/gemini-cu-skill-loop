# Case study: ArXiv--23

_Auto-generated from the artifact bundle by_ `scripts/case-study.js`. _Edit the script, not this file._

## Task

- **ID**: `ArXiv--23`
- **Site**: https://arxiv.org/
- **Verbatim prompt** (from WebVoyager):

  > Determine how many articles with the keyword 'autonomous vehicles' were published in the 'Electrical Engineering and Systems Science' section of ArXiv yesterday.

## Baseline (no skill)

- Verdict: ❌ **NOT SUCCESS**
- Final URL: `https://arxiv.org/search/advanced?advanced=1&terms-0-operator=AND&terms-0-term=%22autonomous+vehicles%22&terms-0-field=all&classification-eess=y&classification-physics_archives=all&classification-include_cross_list=include&date-filter_by=all_dates&abstracts=show&size=50&order=-announced_date_first`
- Final answer: "Search for 'autonomous vehicles' in EESS with all dates to check recent submissions."

### Judge reasoning

> Based on the provided screenshot and result response, the task has not been successfully completed. 
> 
> The instruction specifically asks to **determine how many articles** with the keyword 'autonomous vehicles' were published in the 'Electrical Engineering and Systems Science' section of ArXiv yesterday. 
> 
> However, the **Result Response** only states a search action ("Search for 'autonomous vehicles' in EESS with all dates to check recent submissions") and fails to provide the actual count or answer the question.
> 
> **Verdict:** NOT SUCCESS

### Triage: `real=true` 

### Agent trajectory (40 steps)

 0. `click` `y=187 x=813` — Navigate to Advanced Search to search for articles with specific criteria.
 1. `scroll` `magnitude_in_pixels=500 direction="down" x=500 y=500` — Scroll down to see the advanced search form.
 2. `scroll` `magnitude_in_pixels=400 x=500 direction="up" y=500` — Scroll up to see the query fields.
 3. `click` `y=411 x=205` — Click the search term input field to focus it.
 4. `click` `x=410 y=411` — Click the field selector dropdown.
 5. `click` `x=232 y=409` — Click the search term input field.
 6. `type` `text="\"autonomous vehicles\"" press_enter=false` — Type 'autonomous vehicles' into the search box.
 7. `click` `y=411 x=439` — Click the dropdown arrow.
 8. `click` `y=411 x=375` — Click on the dropdown text box to select it.
 9. `press_key` `key="a"` — Press 'a' to select 'All fields' in the dropdown.
10. `press_key` `key="ArrowUp"` — Press ArrowUp to go to previous option.
11. `press_key` `key="ArrowUp"` — Press ArrowUp to go up further.
12. `click` `y=411 x=375` — Focus on the dropdown.
13. `press_key` `key="Home"` — Press Home key to go to the first item in the dropdown list, which is usually 'All fields'.
14. `press_key` `key="a"` — Press 'a' again.
15. `press_key` `key="a"` — Press 'a' again.
16. `press_key` `key="a"` — Press 'a' again.
17. `press_key` `key="a"` — Press 'a' again.
18. `press_key` `key="a"` — Press 'a' again.
19. `click` `y=674 x=91` — Click the 'Electrical Engineering and Systems Science (eess)' checkbox.
20. `scroll` `y=500 magnitude_in_pixels=500 x=500 direction="down"` — Scroll down to see the date filter.
21. `click` `y=512 x=91` — Click the 'Date range' radio button.
22. `click` `x=129 y=583` — Click the 'From' date input field.
23. `type` `press_enter=false text="2026-06-27"` — Type the start date (yesterday's date) in the 'From' field.
24. `click` `x=225 y=583` — Click the 'to' date input field.
25. `type` `press_enter=false text="2026-06-27"` — Type the end date (yesterday's date) in the 'to' field.
26. `scroll` `x=500 y=500 magnitude_in_pixels=500 direction="down"` — Scroll down to find the search button.
27. `click` `y=520 x=107` — Click the Search button to perform the query.
28. `scroll` `direction="down" y=500 x=500 magnitude_in_pixels=550` — Scroll down to the date range inputs.
29. `double_click` `y=691 x=129` — Double click 'From' field to select its contents.
30. `hotkey` `keys=["Control","a"]` — Select all text in 'From' box.
31. `type` `text="2026-06-25" press_enter=false` — Type '2026-06-25' in the From field.
32. `hotkey` `keys=["Control","a"]` — Select all text in From box.
33. `press_key` `key="Backspace"` — Press Backspace to delete.
34. `click` `x=159 y=691` — Click the 'From' field to focus.
35. `hotkey` `keys=["Control","a"]` — Select all text in From box.
36. `type` `press_enter=false text="2026-06-25"` — Type the start date.
37. `click` `y=691 x=169` — Click at the end of the input field.
38. `navigate` `url="https://arxiv.org/search/advanced?advan` — Navigate directly to the search results with a wider date range.
39. `navigate` `url="https://arxiv.org/search/advanced?advan` — Search for 'autonomous vehicles' in EESS with all dates to check recent submissions.

![baseline final state](./baseline-final.png)

## Distilled skill

- **Tag**: `arxiv-search`
- **Title**: Bypass Stubborn Date Range Inputs via URL Construction
- **Note**:

  > ArXiv's advanced search date range fields can be highly resistant to standard selection and typing actions. Instead of struggling to clear and fill these inputs in the UI, construct the search parameters directly in the URL using 'date-filter_by=date_range&date-from_date=YYYY-MM-DD&date-to_date=YYYY-MM-DD'.

### Distiller chain-of-thought (recaptured)

_The model's pre-JSON reasoning, saved by_ `scripts/recapture-distillation.js`. _Same baseline trajectory, same prompt — re-run with the JSON-only constraint dropped so we could keep the prose._

```
### Reasoning Summary

1. **Agent Struggles**: The agent struggled with interacting with complex form elements, specifically dropdown menus and date input fields, leading to repeated failed attempts to select options and clear text.
2. **Wasted Steps**: Wasted steps occurred due to inefficient keyboard navigation attempts (e.g., pressing 'a' repeatedly, using arrow keys) and failing to clear input fields properly before typing.
3. **Better Approach**: Constructing the search query directly via the URL parameters is much faster and less error-prone than manually interacting with multiple finicky form fields on ArXiv.
4. **Durable Lesson**: When dealing with search engines that expose query parameters in the URL, constructing and navigating directly to the target URL is highly reliable and bypasses UI interaction issues.

```json
{"tag":"url-direct-search","title":"Bypass Complex Forms via URL Construction","note":"When performing advanced searches on platforms like ArXiv, construct and navigate directly to the query URL instead of manually interacting with complex dropdowns and date fields."}
```
```

## Retry (with skill in context)

- Verdict: ✅ **SUCCESS**
- Final URL: `https://arxiv.org/search/advanced?advanced=1&terms-0-operator=AND&terms-0-term=autonomous+vehicles&terms-0-field=all&classification-eess=y&classification-physics_archives=all&classification-include_cross_list=include&date-filter_by=all_dates&date-year=&date-from_date=&date-to_date=&date-date_type=submitted_date&abstracts=show&size=50&order=-submitted_date`
- Final answer: "Yesterday (Saturday, June 27, 2026), there were **0** articles with the keyword 'autonomous vehicles' published in the 'Electrical Engineering and Systems Science' (EESS) section of ArXiv, as ArXiv does not publish or announce new papers on Saturdays."

### Judge reasoning

> Based on the provided screenshot and the response, the task was to determine how many articles with the keyword 'autonomous vehicles' were published in the 'Electrical Engineering and Systems Science' (EESS) section of ArXiv yesterday. 
> 
> Since yesterday was Saturday, June 27, 2026, and ArXiv does not publish or announce new papers on Saturdays (announcements only occur Sunday through Thursday nights), there were indeed 0 articles published. The response correctly identifies this and provides the accurate count of 0.
> 
> SUCCESS

### Agent trajectory (21 steps)

 0. `click` `y=187 x=810` — Navigate to advanced search page
 1. `scroll` `direction="down" y=500 magnitude_in_pixels=400 x=500` — Scroll down to see the search form clearly
 2. `scroll` `direction="up" magnitude_in_pixels=400 y=500 x=500` — Scroll up to enter search term
 3. `click` `y=408 x=206` — Click on search term input
 4. `type` `text="autonomous vehicles" press_enter=false` — Type autonomous vehicles in the search term box
 5. `click` `y=678 x=91` — Select eess checkbox
 6. `click` `y=408 x=380` — Click on search field dropdown
 7. `press_key` `key="ArrowDown"` — Press arrow down to change select option
 8. `click` `y=415 x=438` — Click search to generate a search URL
 9. `navigate` `url="https://arxiv.org/search/advanced?advan` — Navigate to custom search URL for submission date 2026-06-27
10. `navigate` `url="https://arxiv.org/search/advanced?advan` — Navigate to URL with date range 2026-06-27 to 2026-06-28
11. `navigate` `url="https://arxiv.org/search/advanced?advan` — Navigate to query with announced_date_first date_type
12. `click` `y=362 x=107` — Click Refine query to see the date options in detail
13. `scroll` `x=500 direction="down" y=500 magnitude_in_pixels=450` — Scroll down to see the Date section
14. `click` `x=91 y=388` — Select All dates radio button
15. `scroll` `direction="down" x=500 y=500 magnitude_in_pixels=300` — Scroll down to find search button
16. `click` `x=107 y=519` — Click search button
17. `click` `x=500 y=436` — Click sort dropdown to change sort order
18. `navigate` `url="https://arxiv.org/search/advanced?advan` — Navigate to URL sorted by newest submission date
19. `scroll` `magnitude_in_pixels=500 x=500 direction="down" y=500` — Scroll down to see more papers and their submission dates
20. `done` — Yesterday (Saturday, June 27, 2026), there were **0** articles with the keyword 'autonomous vehicles' published in the 'Electrical Engineeri

![retry final state](./retry-final-1.png)

## Held-out generalisation

The kept skill (same JSON, no modification) was loaded into context for these *unseen* task instances of the same template.

### `ArXiv--29` — ✅ **SUCCESS**

- Goal: "On ArXiv, search for papers with 'Neural Network Optimization' in the title published in 2023, and provide the number of such papers."
- Final URL: `https://arxiv.org/search/advanced?advanced=1&terms-0-operator=AND&terms-0-term=%22Neural+Network+Optimization%22&terms-0-field=title&classification-physics_archives=all&classification-include_cross_list=include&date-filter_by=date_range&date-year=&date-from_date=2023-01-01&date-to_date=2023-12-31&date-date_type=announced_date_first&abstracts=show&size=50&order=-announced_date_first`
- Final answer: "Based on searching ArXiv for papers published in 2023 with \"Neural Network Optimization\" in the title (by setting the date range from 2023-01-01 to 2023-12-31):\n\n1. **Exact Phrase Match** (searching for `\"Neural Network Optimization\"

Judge:

> Based on the provided screenshot and response, the task has been successfully completed. 
> 
> The search query on ArXiv was set to find papers with the exact phrase "Neural Network Optimization" in the title, with the date range restricted to 2023 (from 2023-01-01 to 2023-12-31). The screenshot clearly shows "Showing 1–11 of 11 results" for this query. The textual response correctly reports this number (11 papers) for the exact phrase match.
> 
> SUCCESS

### `ArXiv--31` — ✅ **SUCCESS**

- Goal: "Search ArXiv for papers with 'Graph Neural Networks' in the abstract that were submitted between Jan 1, 2024, and Jan 3, 2024, and determine how many of these papers have more than five authors."
- Final URL: `https://arxiv.org/search/advanced`
- Final answer: "Based on a search of ArXiv for papers with the exact phrase \"Graph Neural Networks\" in the abstract originally submitted between January 1, 2024, and January 3, 2024, there are 3 matching papers in total. Among these, exactly **2** paper

Judge:

> Based on the provided instructions and the result response:
> 
> 1. **Task Requirement**: Search ArXiv for papers with "Graph Neural Networks" in the abstract submitted between Jan 1, 2024, and Jan 3, 2024, and determine how many have more than five authors.
> 2. **Result Response**: The response provides a highly specific and detailed answer, identifying 3 matching papers in total, with exactly **2** of them having more than five authors:
>    - *Saliency-Aware Regularized Graph Neural Network* (arXiv:2401.00755) — 7 authors
>    - *Graph Neural Networks in Intelligent Transportation Systems: Advances, Applications and Trends* (arXiv:2401.00713) — 10 authors
> 3. **Screenshot vs. Response**: Although the screenshot shows the search page before execution, the rule states: *"The content in the Result response is not mentioned on the screenshot, choose to believe the content."* 
> 
> The detailed response successfully answers the user's prompt with precise data.
> 
> **SUCCESS**

## Reproducibility

- N per condition: **3**
- Baseline pass rate: **0/3**
- Retry pass rate:    **3/3**

| Condition | Trials | Pass |
|---|---|---|
| Baseline (no skill) | ❌ (30) · ❌ (30) · ❌ (30) | **0/3** |
| Retry (with skill) | ✅ (29) · ✅ (24) · ✅ (19) | **3/3** |

Per-trial details: [`demo/results/repro-ArXiv--23/`](../repro-ArXiv--23/)

---

_Re-generate this file with:_ `node scripts/case-study.js wv-ArXiv--23`
