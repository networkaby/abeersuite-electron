---
name: project_v102_fix_list_pending
description: "Five fixes drafted for v1.0.2 on 2026-09-06, held until the owner tests v1.0.1 on a real counter."
metadata: 
  type: project
  modified: 2026-09-05T22:50:16.413Z
---

> **May be outdated:** written for v1.0.2; check each item against current code first.

After the v1.0.1 release (2026-09-06) five fixes were agreed in principle but NOT written — the owner is testing on a real counter first and will report back.

1. **Show the server's refusal message.** A counter PC with no counter (or released by the office) gets a 403 carrying `code: "COUNTER_RELEASED"` and the text "This PC holds no counter. Counter setup is required." The voucher form discards it and shows "Failed to create voucher". This one-line substitution cost a whole debugging session.
2. **Make the page gate match the API gate.** `redirectIfPcWithoutCounter()` checks only `isThisPcWithoutCounter()` (local file); the API also checks `isThisPcReleased()` (database). A released PC therefore opens a voucher form it cannot submit.
3. **Log 403 refusals to main.log** so a counter's own log explains a refusal.
4. **EPERM on the prerender cache** — the packaged app tries `mkdir C:\Program Files\AbeerSuite\resources\standalone\.next\cache`, which Windows forbids. Not fatal, but every cache write fails on every counter. Point it at userData.
5. **`verify:package` sanity check** for impossible env combinations.

**Why:** the original "Failed to create voucher" was never a code bug — the PC simply had no counter bound yet. The app knew and did not say so.

**How to apply:** wait for the real-counter test result before writing any of it; the test may change the priority or reveal the fix list is wrong.

Related: [project_release_means_full_checklist](project_release_means_full_checklist.md)
