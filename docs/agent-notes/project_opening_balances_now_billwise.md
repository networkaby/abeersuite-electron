---
name: project_opening_balances_now_billwise
description: "2026-09-16 — all 64 party opening balances on live were converted from the master scalar to real OPENING bills; none remain."
metadata: 
  type: project
  modified: 2026-09-15T20:50:36.210Z
---

Ran `pnpm opening:to-bills --apply` against **live** on 2026-09-16 at the owner's
instruction ("just backfill opening balance to bill, simulate manual edit to save
user time"). **64 of 64 party ledgers converted, ₹276,855.20 total** — 59 Sundry
Debtors, 5 Sundry Creditors; 34 Dr ₹22,563.00 and 30 Cr ₹254,292.20.

Each became ONE `OPENING` voucher dated **2026-04-01**, ref **"Opening Balance"**,
posted as Super Admin, counter-leg on ledger **#10409 "Suspense A/c"** (group #9;
`resolveSuspenseLedger` prefers the name-matched ledger over the stray "Cash Over"
filed under the same group). Verified after: `pnpm opening:preview` and the
`opening:to-bills` dry run both report **0 accounts left on the scalar**.

No repo files changed — this is a pure data change with no commit behind it.

**Why:** the money is no longer invisible. A scalar opening had no GL legs, so
Receivables, Payables and bill-wise linking could not see it, and nothing could be
settled against it. It is now an ordinary bill that ages and takes receipts. The
conversion is **balance-neutral on screen** — `effectiveAccountBalance` already
added the scalar, so the figure just moved into `Account.balance`; no customer's
POS credit check changed (preview confirmed 0 would newly exceed a limit).

**How to apply:** the breakup into *several* real bills is still per-party manual
work, in the Bill-wise details dialog (customer Profile tab, ledger master, or the
Opening Balance master page) — the backfill only made one bill each. Two things
stay open: (1) the existing unlinked Payments on parties like Akramul Da still
show "Due" and must be settled against the new opening bill; (2) account **#10514
"SUSPENSE A/c"** under Sundry Debtors is a migration leftover that converted like
a normal party — worth cleaning up. The Transactions tab's opening row is still
dead (no link, no menu) — see [project_ux_six_patterns_branch](project_ux_six_patterns_branch.md) territory in
`TransactionsTable.tsx` if an entry point is wanted there.
