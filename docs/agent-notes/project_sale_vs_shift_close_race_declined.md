---
name: project-sale-vs-shift-close-race-declined
description: Owner declined locking the shift on ordinary POS sales (sale racing shift close); do not re-propose
metadata:
  type: project
---

Ordinary POS sale (exact, part or full credit) does not hold or re-check the shift inside its save; only a sale collecting extra does (`touchPosShift`). Owner declined a fix on 2026-11-26: do not suggest it again.

**Why:** the shift is closed from the same counter that bills, and a manager closes only when the counter was shut down without closing, so nobody is billing then. By design, extra payment = credit sale + receipt voucher for the full amount.

**How to apply:** skip it in reviews and audits. Reopen only if a real over/short matches a bill saved at closing time, or the owner asks. Related: [project_voucher_locks_held](project_voucher_locks_held.md).
