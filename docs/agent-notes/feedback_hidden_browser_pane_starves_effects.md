---
name: feedback_hidden_browser_pane_starves_effects
description: "A hidden Browser pane never flushes React mount effects, so a screen looks permanently empty when it is only still loading."
metadata: 
  type: feedback
  modified: 2026-09-17T03:23:21.422Z
---

When the Browser pane is hidden (`tabs_context` says so), the page renders but
React's passive effects never flush and `setTimeout` is throttled hard. A screen
whose data arrives in `useEffect` therefore sits on its first-paint markup
forever: no API call appears in the network log, and any Radix `Select` shows a
blank trigger because its value effect has not run either. Only a real
`computer` click — a genuine user gesture — flushes it.

**Why:** this fakes a total breakage. On 2026-09-17 the Stock Summary screen was
reported as showing "No active products found" while its API returned 1,462
rows; the evidence had been gathered through a hidden pane, and the rows in fact
rendered fine once an effect flush happened.

**How to apply:** before calling a screen broken, check `tabs_context` for
"hidden". Verify the first paint by fetching the page HTML from inside the page
(`fetch(url, {headers:{accept:'text/html'}})`) and grepping it — that reads the
real server-rendered markup and is immune to throttling. It is how both the bug
and the fix were proved here. Burning time with `setTimeout` does not work; use a
click or network I/O. Related: [project_worktree_cannot_be_browser_verified](project_worktree_cannot_be_browser_verified.md),
[project_db_probing_via_dev_server](project_db_probing_via_dev_server.md).
