# Completed and protected surfaces

Purpose: keep critical completed features stable. Any agent/human touching these areas must preserve existing behavior unless explicit approval says otherwise.

## Completed list (protect from accidental regressions)

- [x] POS counter flow (`/office/pos`)
- [x] Accountancy Balance Sheet (`/office/accountancy/reports/balance-sheet`)
- [x] Accountancy Profit & Loss (`/office/accountancy/reports/profit-loss`)
- [x] Accountancy Day Book (`/office/accountancy/reports/day-book`)
- [] Accountancy Trial Balance (`/office/accountancy/reports/trial-balance`)
- [] Accountancy Cash Book (`/office/accountancy/reports/cash-book`)
- [] Accountancy Bank Book (`/office/accountancy/reports/bank-book`)
- [] Accountancy Receivables (`/office/accountancy/reports/receivables`)
- [] Accountancy Payables (`/office/accountancy/reports/payables`)

## Guardrails before changing any protected surface

1. Read the relevant module doc first:
   - `docs/modules/pos.md` for POS
   - `docs/modules/accountancy.md` for accounting reports
2. Treat behavior changes as opt-in: UI cleanup/refactor is allowed, logic/output changes need explicit user sign-off.
3. Preserve report math and totals:
   - Keep `effectiveLedgerBalance`, `aggregateClosingAsOf`, `aggregateRange`, `netProfitLoss` wiring intact.
   - Do not replace helper math with new inline arithmetic.
4. Validate before declaring done:
   - POS: customer pick/create, cart, checkout shortcut, invoice creation.
   - Reports: page loads, totals render, drilldown links still work.
5. If a protected surface must change by request, update this file and note what changed and why in the same PR.

_Last updated: 2026-05-11._
