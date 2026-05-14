# Completed and protected surfaces

Purpose: keep critical completed features stable. Any agent/human touching these areas must preserve existing behavior unless explicit approval says otherwise.

## Completed list (protect from accidental regressions)

- [x] POS counter flow (`/office/pos`) — now gated by an active `PosShift` per cashier; cash sales debit the cashier's till and close the customer AR in the same transaction (2026-05-14)
- [x] POS shift lifecycle — `/office/pos/shifts` report, shift open/close with opening float + variance Contra to branch vault (2026-05-14)
- [x] POS sale return GL math — `Dr Sales Revenue / Cr Counter Till` (CASH) or `Dr Sales Revenue / Cr Customer AR` (CREDIT); `SALE_RETURN InvVoucher` + `InvStockLedger` IN; `Invoice.returnOfId` back-link; three-tier lookup (by invoice #, by customer, lost-invoice manager bypass) (2026-05-14)
- [x] Accountancy Balance Sheet (`/office/accountancy/reports/balance-sheet`)
- [x] Accountancy Profit & Loss (`/office/accountancy/reports/profit-loss`)
- [x] Accountancy Day Book (`/office/accountancy/reports/day-book`)
- [x] Accountancy Trial Balance (`/office/accountancy/reports/trial-balance`)
- [] Accountancy Cash Book (`/office/accountancy/reports/cash-book`)
- [] Accountancy Bank Book (`/office/accountancy/reports/bank-book`)
- [] Accountancy Receivables (`/office/accountancy/reports/receivables`)
- [] Accountancy Payables (`/office/accountancy/reports/payables`)
- [x] Accountancy Journal Voucher flow (`/office/accountancy/journal-entries` + `JournalVoucherDialog`)
- [x] Accountancy Payment Voucher flow (`/office/accountancy/payments` + `VoucherForm`)
- [x] Accountancy Receipt Voucher flow (`/office/accountancy/receipts` + `VoucherForm`)
- [x] Accountancy Contra Voucher flow (`/office/accountancy/contras` + `ContraDialog`)
- [x] Full-page Purchase Invoice route (`/purchase`) — replaces PurchaseDialog; do not revert to dialog flow
- [x] Sale Return voucher flow (`/sale-return`) — inventory IN, GL Dr Sales Returns / Cr party
- [x] Purchase Return voucher flow (`/purchase-return`) — inventory OUT, GL Dr party / Cr Purchase Returns

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
   - POS return: three-tab dialog (invoice #, customer, lost invoice), refund mode toggle, CASH/CREDIT GL path, stock IN.
   - Reports: page loads, totals render, drilldown links still work.
5. If a protected surface must change by request, update this file and note what changed and why in the same PR.

_Last updated: 2026-05-14 — POS sale return GL math + three-tier lookup protected._
