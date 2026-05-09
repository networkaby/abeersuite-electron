# Accountancy

> Full Tally-style accounting suite — chart of accounts, vouchers, invoices, payments, GL reports, GST hub. Renamed from "Tally" on 2026-05-07. Gated behind `accountancy:view:org` so only Owner / CA see it; everyone else's sidebar hides the section entirely.

## URLs

### UI pages (all gated by `src/app/(protected)/office/accountancy/layout.tsx`)
- `/office/accountancy` → `src/app/(protected)/office/accountancy/page.tsx`
- `/office/accountancy/dashboard` → `src/app/(protected)/office/accountancy/dashboard/page.tsx`
- `/office/accountancy/sales[/new][/[id]]`, `/office/accountancy/purchases[/new][/[id]]`
- `/office/accountancy/payments`, `/receipts`, `/contras`, `/credit-notes`, `/debit-notes`, `/estimates`
- `/office/accountancy/journal-entries`, `/invoices`, `/ledgers`, `/groups`, `/chart-of-accounts`, `/opening-balance`, `/account/[id]`
- `/office/accountancy/reports/{balance-sheet,profit-loss,trial-balance,day-book,cash-book,bank-book,receivables,payables,cash-flow,fund-flow,ratio-analysis,statistics,bank-reconciliation,ledger-outstandings/[ledgerId]}`
- `/office/accountancy/reports/gst/{liability,outward-supplies,inward-supplies,hsn-summary}`

Legacy `/office/tally/*` URLs 307-redirect to `/office/accountancy/*` via `next.config.ts`.

### API routes (all under `src/app/api/finance/`)
- List/read endpoints (~30 files) gated by `requirePermission("accountancy:view:org")` — invoices, journal-entries, vouchers, ledgers, gl-accounts, account-groups, opening-balance, allocations, all `reports/*`.
- Operation endpoints (cancel/delete/post/restore) keep their fine-grained `finance:*:*` keys (e.g. `finance:invoice:cancel`, `finance:voucher:post`).

API folder is still `/api/finance/*` — rename deferred to Step 5 (route restructure).

## Permissions (gate keys)

- `accountancy:view:org` — module-level gate. Hides sidebar section + redirects on direct nav + 403 on API. See [permission_matrix memory](../../memory/permission_matrix.md).
- `finance:invoice:cancel` / `delete` / `hard-delete` — three-tier invoice lifecycle.
- `finance:journal:cancel` / `delete` / `hard-delete` — three-tier journal lifecycle.
- `finance:payment:cancel` / `delete` / `hard-delete` — three-tier payment lifecycle.
- `finance:voucher:create` / `post` / `cancel` / `delete` / `hard-delete` — Tally-style voucher lifecycle (Contra / Payment / Receipt / Credit Note / Debit Note).
- `finance:allocation:manage` — bill-wise allocation (links any voucher to any other for outstandings + aging).
- `finance:opening-balance:manage` — edit per-account opening balances at books-beginning date.

## Prisma models (file: `prisma/schema/finance.prisma`)

- `JournalEntry` + `JournalLine` — double-entry GL.
- `Invoice` + `InvoiceLine` + `InvoiceAudit` — sales invoices. **`Invoice.ticketId`** is the new soft back-link to the repair ticket (added Step 4, 2026-05-07; replaces deprecated `TicketPart`).
- `Voucher` + `VoucherLine` — Contra / Payment / Receipt / Credit Note / Debit Note.
- `Payment` + `PaymentAllocation` — payments + bill-wise links.
- `Account` (in `prisma/schema/customers.prisma`) — dual-purpose GL account + customer/company ledger.
- `OpeningBalance` — per-account books-beginning balances.

## Key components / library

- `src/modules/accountancy/components/` — `VoucherForm`, `VoucherList`, `VoucherDetail`, `LifecycleActions`, `BookPage`, `DrillRow`, `PartyCombobox`, `GstSummaryView`, `JournalVoucherDialog` (Tally-style adjustment voucher with Dr/Cr columns + optional inventory items per line — opens via `useJournalVoucherStore` from anywhere).
- `src/modules/accountancy/lib/` — see helpers registry below.

## Reusable helpers — DO NOT duplicate ⚠️

These are the **single source of truth** for every balance/value calculation in the app. Before writing new SUM logic, opening-folding logic, or inline `balance + opening` math, **search this list first**. Adding a new call site = one import; reproducing the math inline causes drift between reports and drilldowns (we hit this twice in 2026-05-09).

| Helper | File | Purpose | Use when |
|---|---|---|---|
| `balanceDelta(normalBalance, entryType, amount)` | `src/modules/accountancy/lib/balance.ts` | Sign-corrected GL delta for a posting | Updating `Account.balance` on voucher post; folding opening into running balance |
| `isBalanced(lines)` | same | True iff Σ debits == Σ credits within tolerance | Voucher pre-flight before save/post |
| `toNumber(v)` | same | Prisma Decimal / string → number | Reading any `Decimal` field in JS |
| `nextRef(tx, model, prefix)` | same | Sequential reference (`PV-2026-0001`) | Generating voucher / JE references inside a transaction |
| **`effectiveLedgerBalance(account)`** | `src/modules/accountancy/lib/effectiveBalance.ts` | True closing = `Account.balance` (tx running) **+** sign-corrected opening | Any UI/API displaying a single account balance — chart of accounts, group ledger rows, account detail |
| **`loadGroupRolledUpBalances([groupIds])`** | same | Bulk `Map<groupId, totalEffectiveBalance>` walking descendants | Group lists / trees that show rolled-up balances per node |
| `EFFECTIVE_BALANCE_SELECT` | same | Prisma `select` shape for the four fields the helper needs | Pass to `findMany`/`findUnique` to get the right fields without typing them out |
| `aggregateClosingAsOf(asOf, nbMap)` | `src/modules/accountancy/lib/aggregateLedger.ts` | Per-account closing balance over `JournalLine` for a date | Balance Sheet engine |
| `aggregateRange(from, to, nbMap)` | same | Per-account opening + tx + closing over a period | P&L / Trial Balance engine |
| `loadMasterOpeningBalances(asOf, nbMap)` | same | `Map<accountId, signedOpening>` for opening balances dated ≤ asOf | Folded into `aggregateClosingAsOf` and `aggregateRange` automatically |
| `loadNormalBalanceMap()` | same | `Map<accountId, "DEBIT"|"CREDIT">` with group fallback | Pass into the aggregators above |
| **`netProfitLoss(from, to)`** | same | Net P&L for period — **trading-aware** (folds in closing-stock − opening-stock) | Balance Sheet's Equity row, dashboards, ratio analysis |
| **`computeTradingStockAdjustment(from, to)`** | `src/modules/accountancy/lib/tradingStockAdjustment.ts` | `{ openingStock, closingStock, adjustment }` for the period | P&L trading account; called by `netProfitLoss()` |
| **`getClosingStockValue()`** | `src/modules/accountancy/lib/closingStock.ts` | Live org-wide stock total (delegates per-row to `productClosingValue`) | Balance Sheet's Stock-in-Hand line; trading adjustment |
| `defaultNormalBalanceForGroupType(type)` | `src/modules/accountancy/lib/groupNature.ts` | Fallback DEBIT/CREDIT inferred from `AccountGroup.type` | When `Account.normalBalance` is null |
| `voucherLifecycle.ts` helpers | `src/modules/accountancy/lib/voucherLifecycle.ts` | Shared cancel/delete/restore/hard-delete across Invoice/Payment/Voucher/InvVoucher | Lifecycle endpoints |
| `postInvVoucherToGl(tx, input)` | `src/modules/accountancy/lib/postInvVoucher.ts` | Auto-create JE for SALE/PURCHASE InvVouchers (Sales/Purchase A/c + party + GST + round-off) | Inside `/api/inventory/vouchers/[id]/post/route.ts` only |
| `period.ts` (`indianFiscalYearStart`, `parseAsOf`, `parseRange`, `formatDateInput`) | `src/modules/accountancy/lib/period.ts` | Indian FY math + URL-param parsing for reports | Any report API/page |
| `isStockEligibleAccount(a)` | `src/modules/accountancy/lib/stockEligibleAccount.ts` | True iff `account.group.type` ∈ {INCOME, EXPENSE} | Gating "+ Inventory item" affordances on journal vouchers; rejecting bad payloads on the API |

### Architectural rule

`Account.balance` is a **transaction-only running cache** updated by post handlers. **Never display it directly** — always pass through `effectiveLedgerBalance()` so the opening balance is folded in. The four endpoints that previously read `balance` raw (chart of accounts, group detail, account-groups tree, account detail) all wrap it now; new endpoints must too.

## Common workflows (wiring)

1. **Create sale invoice** — UI [src/app/(protected)/office/accountancy/sales/new/page.tsx](../../src/app/(protected)/office/accountancy/sales/new/page.tsx) → POST `/api/finance/invoices` → creates `Invoice` + `InvoiceLine[]` + (when status=SENT) auto-posts AR/Revenue `JournalEntry`.
2. **Create voucher (e.g. payment)** — `/office/accountancy/payments/new` → POST `/api/finance/vouchers` (validated against `isBalanced`) → DRAFT row, separately post via `/api/finance/vouchers/[id]/post`.
3. **Bill-wise allocation** — POST `/api/finance/allocations` linking any source voucher to any target (full or partial).
4. **Drill-down on ledger** — `/office/accountancy/ledgers/[id]` → reads from `/api/finance/reports/ledger/[accountId]`.
5. **Tally-style journal voucher (with optional inventory)** — `useJournalVoucherStore.setOpen(true)` from any page → `JournalVoucherDialog` → POST `/api/finance/journal-vouchers` (atomic: Voucher + JE + Account.balance + optional STOCK_JOURNAL InvVoucher carrier + InvStockLedger). Inventory items are gated to INCOME/EXPENSE ledgers via `isStockEligibleAccount`.
6. **Set opening balance on master save** — POST/PATCH `/api/finance/gl-accounts` (writes `openingBalance/openingBalanceType/openingBalanceDate` directly) and POST/PATCH `/api/inventory/products` (also syncs `stock`/`costPaise` cache via `syncProductCacheFromOpening`). The `/office/accountancy/opening-balance` page exposes both inline + dedicated quick-create dialogs.

## Recent decisions / gotchas

- **2026-05-07 rename**: was `tally` → now `accountancy`. Folder, URL, permission area all changed. Sidebar label too. Compat redirect handles `/office/tally/*`. See [simplification_roadmap memory](../../memory/simplification_roadmap.md).
- **API folder still at `/api/finance/*`** — rename deferred to Step 5.
- **2026-05-09 — Account.balance ≠ closing balance**: `Account.balance` is a transaction-only running cache. Reports that read it raw under-report opening-only ledgers (Cash, Bank, Capital). Always wrap with `effectiveLedgerBalance(a)` (or use the bulk variant `loadGroupRolledUpBalances`). The chart-of-accounts list, group detail, account detail, and account-groups tree all wrap it now — new endpoints must too. See helpers registry above.
- **2026-05-09 — Trading-aware netProfitLoss**: `netProfitLoss(from, to)` includes the closing-stock − opening-stock adjustment from `computeTradingStockAdjustment`. Both BS Equity and P&L net profit use it, so they always reconcile. Don't sum INCOME − EXPENSE journal lines yourself.
- **2026-05-09 — Closing Stock injection**: BS API injects the live `closingStock.computed − postedToGl` value as a synthetic ledger (`id: -1`, name "Closing Stock (live)") inside the Stock-in-Hand group so the rolled-up totals flow naturally. `goLedger` short-circuits on negative ids — keep that guard if you copy the click handler elsewhere.
- **2026-05-09 — Suspense ledger**: When opening Dr ≠ opening Cr (incl. opening stock value), the gap auto-parks in "Difference in Opening Balances". Surface this on any opening-balance UI; never silently absorb the diff.
- **2026-05-09 — Stock-in-Hand has no GL children**: `bootstrap-seed.ts` creates the Stock-in-Hand account group but no ledgers under it. Live closing-stock value is injected as a synthetic ledger at report time (`balance-sheet/route.ts`). DO NOT add real Account rows under this group — they would double-count with the synthetic injection.
- **2026-05-09 — Single bootstrap seed**: `pnpm prisma db seed` runs `bootstrap-seed.ts` (the only production seed). All other `dummy-*.ts` are dev-only and removed by `pnpm seed:hard-clean`. Schema changes must be mirrored in `bootstrap-seed.ts`.
- **2026-05-09 — `Difference in Opening Balances` is synthetic**: there is no GL ledger by this name in the chart of accounts. The Balance Sheet auto-computes `assetsTotal − liabilitiesTotal` and shows the absolute value as a standalone "Difference in opening balances" row on whichever side is short (Liabilities when assets exceed; Assets when liabilities exceed). Once the user enters a balancing Capital / Loan opening, the row disappears. Don't add a real ledger by this name — `hard-clean.ts` deletes it from legacy DBs anyway.

## Out of scope / deferred

- GSTR returns, e-Invoice, RCM — deferred (see [tally_module_status memory](../../memory/tally_module_status.md)).
- Cost centres / budgets / multi-currency — cut.
- Renaming `/api/finance/*` to `/api/accountancy/*` — deferred to Step 5.

_Last updated: 2026-05-09 — added centralized helpers (effectiveBalance, tradingStockAdjustment, journal-vouchers atomic endpoint, JournalVoucherDialog), opening-balance write paths, BS Stock-in-Hand injection, P&L↔BS reconciliation._
