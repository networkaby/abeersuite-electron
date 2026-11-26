---
name: wa-send-leftovers-deferred
description: Three WhatsApp send gaps left after the unclear-vs-refused fix; owner said ok for now
type: project
---

Left open after e514aec78 (2026-11-26), owner said "its ok for now":
- `deliver` in notifyBill.ts treats any DB error on the claim insert as "already".
- Due reminder log is written after the send, so a crash between can repeat it another day.
- UPI request has no once-only key; a double press sends twice.

**Why:** owner deferred; not worth the change yet.
**How to apply:** do not re-propose unless a real repeat/miss is reported.
