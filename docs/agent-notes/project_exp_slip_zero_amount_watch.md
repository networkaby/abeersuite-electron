---
name: project_exp_slip_zero_amount_watch
description: "POS Exp payment slip once printed without the amount, then fixed itself; owner is observing before any fix (2026-09-27)"
metadata:
  type: project
  modified: 2026-09-27T13:06:37.237Z
---

On 2026-09-27 the owner reported the POS Exp (counter expenditure) payment voucher slip printed without the amount. The same day it printed correctly again, with no code change in between. Owner chose to "observe more" before any fix.

Suspected cause (unproven): a timing gap on a v_live counter. PosExpenditureDialog saves, then does a separate GET /api/print/thermal/gl/:id against the till's replica. The sync engine applies UniversalVoucher and its VoucherGlLine children in separate transactions, and writeRelay's pullAndWait gives up after 3 s. A print that lands in that gap sees a voucher with no lines, so the slip shows "PAID 0.00", "Paid to: —" and no "By:" line. The bridge layout (hardware-bridge/thermal.js printMoneyMiddle) printed the amount correctly in an offline test.

**Why:** the owner wants proof before a change; it may recur on a slow-internet day.

**How to apply:** if it recurs, ask whether a reprint from the POS register (Payment/Receipt tab) shows the amount. A reprint that shows the amount confirms the race. The plan already proposed: Exp/Rcv POST returns the ready relayPayload the way /api/pos/sale does for receiptPrint; buildPaymentSlipPrint returns null when lines are empty; add an amount assertion to the PAYMENT test in hardware-bridge/thermal.test.js. Side note: the Exp narration always contains an em-dash, which makes ESC/POS switch the code page mid-slip. Related: [project_v_live_relay_dominates_till_latency](project_v_live_relay_dominates_till_latency.md).
