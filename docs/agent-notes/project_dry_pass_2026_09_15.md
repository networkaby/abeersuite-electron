---
name: project-dry-pass-2026-09-15
description: "DRY pass status — batches 0-11 plus the brands spike landed on dev 2026-09-15; owner declined round2, rupees-in-words and the extractApiError sweep"
metadata: 
  type: project
  modified: 2026-09-14T21:04:23.689Z
---

The DRY plan (`~/.claude/plans/squishy-doodling-breeze.md` findings, `lively-mixing-balloon.md` blueprint) is done through Batch 11 and the brands spike, all on `dev` on 2026-09-15, on top of the still-unreleased voucher-save perf commits.

**Owner decisions during the grill, not to be re-proposed:**
- One `round2` (Batch 5) — declined; the EPSILON-less copies stay.
- One rupees-in-words (Batch 6) — declined; `numberToWords.ts` stays, negatives still clamp to "Zero Rupees Only".
- `extractApiError` adoption sweep (Batch 12) — parked; branch refusals keep the sentence in `error` and add `code`, so the 46 hand-rolled readers never see a raw code.
- `.strict()` on the product create schema — declined; dialog fix only.
- A typed sale price of 0 is a real price (free item).
- Release sequencing: owner chose NOT to release perf first; DRY landed on top and they will cut a dev build to test both.

**Why:** these were explicit choices in `AskUserQuestion`; proposing them again wastes the owner's time.

**How to apply:** if asked to continue DRY work, start from what is still open — the seven other masters pages (one at a time, `useApiResource` + `extractApiError`, no `useTableSort` where there is no sortable column), board snapshot pagination (needs a UX call on Admin Tasks / Deals / Help load-more), and the `effectiveSalePriceSource=SAVED` question surfaced in Batch 0 (neither product dialog sets it). See [project_permissions_page_level_for_now](project_permissions_page_level_for_now.md) for the deferred API-gating findings.
