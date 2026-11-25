---
name: project-pinelabs-test-pending
description: Pine Labs gateway built 2026-11-13 (1f915e67f) but never test-paid; amounts/live host/paid-status unconfirmed
metadata:
  type: project
  modified: 2026-11-12T20:23:01.810Z
---

Pine Labs (Plural) shop checkout landed 2026-11-13 in commit 1f915e67f, on main and dev, unpushed. A UAT test payment is still pending: the owner's Pine Labs dashboard login OTP was not arriving, so testing was put off.

**Why it matters:** Pine Labs' docs leave four things unclear, and the code assumes each one:
- amounts are in paise
- the live host is api.pluralpay.in
- PROCESSED or SETTLED means paid
- what the callback carries back

**How to apply:**
- When the owner resumes, they paste the test keys into App Settings → Pine Labs and activate the gateway in TEST with a settlement ledger.
- Then place one test order and confirm the four points in src/shared/lib/payments/pinelabs.ts.
- Never switch it to LIVE before that. KYC was at 0% on 2026-11-13.
- The webhook is not built; it needs pgsupport@pinelabs.com to enable it.
