---
name: project-portal-contact-merge-recycled-number
description: App contact add auto-merges counter profile / links company after OTP; recycled-number guard planned but parked by owner (2026-10-28)
metadata:
  type: project
  modified: 2026-10-28T10:45:26.420Z
---

Since 2026-10-28 (commits 2c8baf95, 16ae29eb) `POST /api/portal/me/contacts` with an OTP token: a mobile/email on another Person → `mergeParty` with the signed-in profile as winner; on a Company → the contact moves to the person and a PersonCompany link is made.

Known hole: a recycled mobile number (old customer's SIM reissued) lets the new holder absorb the old customer's bills/ledger/points, or get linked to the company.

**Why parked:** owner judged it a rare case; no code now, plan kept.

**How to apply (if it comes up):** auto-merge/link only when the other profile had a bill/receipt in the last ~6 months (tunable constant); otherwise move just the contact to the signed-in person and leave the old profile untouched for the shop to merge by hand in Customer Tools. Name matching only as a soft extra signal.
