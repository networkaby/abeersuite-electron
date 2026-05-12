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

### Trading voucher creation pages (outside accountancy layout gate)

These four routes are **not** under `office/accountancy/layout.tsx` — each has its own lightweight layout. All share `SaleVoucherPage` parameterised by `kind`:

| Route | Kind | Notes |
|---|---|---|
| `/sale` | `SALE` | Sale Invoice — stock OUT, GL Cr Sales / Dr party |
| `/purchase` | `PURCHASE` | Purchase Invoice — stock IN, GL Dr Purchase / Cr party. Replaces the old `PurchaseDialog`. `/office/accountancy/purchases/new` redirects here. |
| `/sale-return` | `SALE_RETURN` | Customer returns goods — stock IN, GL Dr Sales Returns / Cr party |
| `/purchase-return` | `PURCHASE_RETURN` | Return goods to supplier — stock OUT, GL Dr party / Cr Purchase Returns |

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

- `src/modules/accountancy/components/` — `VoucherForm`, `VoucherList`, `VoucherDetail`, `LifecycleActions`, `BookPage`, `DrillRow`, `PartyCombobox`, `GstSummaryView`, `JournalVoucherDialog` (Tally-style adjustment voucher with Dr/Cr columns + optional inventory items per line — opens via `useJournalVoucherStore` from anywhere), `DebitNoteDialog` (modal debit note creator that posts to `/api/finance/vouchers` and opens via `useDebitNoteDialogStore` from ButtonBar / More actions), `ContraDialog` (Tally-style contra entry: destination account at top, multi-source particulars table, only Cash-in-Hand/Bank Accounts ledgers allowed, opens via `useContraDialogStore`).
- **`SaleVoucherPage`** (`src/app/(protected)/office/accountancy/components/SaleVoucherPage.tsx`) — single parameterised full-page form for all four `TradingKind` values (`"SALE" | "PURCHASE" | "SALE_RETURN" | "PURCHASE_RETURN"`). Driven by a `PER_KIND` config map (`KindConfig`: title, partyGroup, ratePick, refLabel, listPath, narrationFallback, success messages, column-visibility flags). Features: CASH / CREDIT mode toggle, line-item table (qty / rate / line discount / tax), overall discount, round-off, payment terms (Net 15/30/45/60), cash/bank ledger picker, and estimated-profit panel. Column prefs persisted to `localStorage`.
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
| `postInvVoucherToGl(tx, input)` | `src/modules/accountancy/lib/postInvVoucher.ts` | Auto-create JE for all four `TradingKind` InvVouchers — SALE/PURCHASE/SALE_RETURN/PURCHASE_RETURN (Sales/Purchase A/c + party + GST + round-off; stock direction follows Dr/Cr side) | Inside `/api/inventory/vouchers/[id]/post/route.ts` only |
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
7. **Create debit note via dialog** — `ButtonBar` / `AllCreateActionsDialog` action `new-debit-note` → `useDebitNoteDialogStore.setOpen(true)` → `DebitNoteDialog` → POST `/api/finance/vouchers` with `type=DEBIT_NOTE` (+ optional allocations via `/api/finance/allocations`) and optional post via `/api/finance/vouchers/[id]/post`.
8. **Create contra via dialog** — `ButtonBar` / `AllCreateActionsDialog` action `new-contra` (or `/office/accountancy/contras/new` thin opener route) → `useContraDialogStore.setOpen(true)` → `ContraDialog` → POST `/api/finance/vouchers` with `type=CONTRA` (top Account = DEBIT destination; Particulars rows = CREDIT sources). Picker options are restricted to `ACCOUNT_GROUPS.CASH_IN_HAND` + `ACCOUNT_GROUPS.BANK_ACCOUNTS`.
9. **Trading voucher flow (all four kinds)** — Navigate to `/sale`, `/purchase`, `/sale-return`, or `/purchase-return`. Toggle CASH (free-text walk-in) / CREDIT (party via `PartySearchAndCreate`). Add items with qty, rate, line discount (% + ₹), tax (auto-computed). Optionally set payment terms (Net 15/30/45/60) or pick a cash/bank ledger. Save → POST `/api/inventory/vouchers`. Post GL + stock → POST `/api/inventory/vouchers/{id}/post` (calls `postInvVoucherToGl` + updates `InvProduct.stock` cache atomically). Optional auto-print redirects to `/receipt/invoice/{id}?autoprint=1`.

## Recent decisions / gotchas

- **2026-05-07 rename**: was `tally` → now `accountancy`. Folder, URL, permission area all changed. Sidebar label too. Compat redirect handles `/office/tally/*`. See [simplification_roadmap memory](../../memory/simplification_roadmap.md).
- **API folder still at `/api/finance/*`** — rename deferred to Step 5.
- **2026-05-09 — Account.balance ≠ closing balance**: `Account.balance` is a transaction-only running cache. Reports that read it raw under-report opening-only ledgers (Cash, Bank, Capital). Always wrap with `effectiveLedgerBalance(a)` (or use the bulk variant `loadGroupRolledUpBalances`). The chart-of-accounts list, group detail, account detail, and account-groups tree all wrap it now — new endpoints must too. See helpers registry above.
- **2026-05-09 — Trading-aware netProfitLoss**: `netProfitLoss(from, to)` includes the closing-stock − opening-stock adjustment from `computeTradingStockAdjustment`. Both BS Equity and P&L net profit use it, so they always reconcile. Don't sum INCOME − EXPENSE journal lines yourself.
- **2026-05-09 — Closing Stock injection**: BS API injects the live `closingStock.computed − postedToGl` value as a synthetic ledger (`id: -1`, name "Closing Stock (live)") inside the Stock-in-Hand group so the rolled-up totals flow naturally. `goLedger` short-circuits on negative ids — keep that guard if you copy the click handler elsewhere. The synthetic ledger row in the BS itself drills to `/office/inventory/stock-summary?ref=balance-sheet&asOf=…`.
- **2026-05-12 — Stock-in-Hand group page redirects to Stock Summary**: `/office/accountancy/groups/[id]/page.tsx` detects `group.name === "Stock-in-Hand"` and `router.replace`s to `/office/inventory/stock-summary` (preserving `asOf`). Any entry path — Balance Sheet group click, Ledgers index, direct URL — bypasses the empty group detail page. Don't add real Account rows under Stock-in-Hand to "fix" the empty page; the redirect is intentional because Closing Stock is computed live, not GL-posted.
- **2026-05-12 — `getClosingStockValue` is now a wrapper**: lives in `src/modules/accountancy/lib/closingStock.ts` but delegates to `valueStockOrgTotal("LAST_COST")` (`src/modules/inventory/lib/valuation.ts`). Adding new valuation methods does NOT change BS behaviour unless callers explicitly switch method.
- **2026-05-09 — Suspense ledger**: When opening Dr ≠ opening Cr (incl. opening stock value), the gap auto-parks in "Difference in Opening Balances". Surface this on any opening-balance UI; never silently absorb the diff.
- **2026-05-09 — Stock-in-Hand has no GL children**: `bootstrap-seed.ts` creates the Stock-in-Hand account group but no ledgers under it. Live closing-stock value is injected as a synthetic ledger at report time (`balance-sheet/route.ts`). DO NOT add real Account rows under this group — they would double-count with the synthetic injection.
- **2026-05-09 — Single bootstrap seed**: `pnpm prisma db seed` runs `bootstrap-seed.ts` (the only production seed). All other `dummy-*.ts` are dev-only and removed by `pnpm seed:hard-clean`. Schema changes must be mirrored in `bootstrap-seed.ts`.
- **2026-05-09 — `Difference in Opening Balances` is synthetic**: there is no GL ledger by this name in the chart of accounts. The Balance Sheet auto-computes `assetsTotal − liabilitiesTotal` and shows the absolute value as a standalone "Difference in opening balances" row on whichever side is short (Liabilities when assets exceed; Assets when liabilities exceed). Once the user enters a balancing Capital / Loan opening, the row disappears. Don't add a real ledger by this name — `hard-clean.ts` deletes it from legacy DBs anyway.
- **2026-05-10 — TODO: bill-wise allocation in JournalVoucherDialog**: the dialog at `src/modules/accountancy/components/JournalVoucherDialog.tsx` shows a "party ledger (bill-wise pending)" hint when the picked account is in `Sundry Debtors` / `Sundry Creditors`, but the actual `BillAllocationDrawer` integration (used by `VoucherForm.tsx` for Payment / Receipt) is not yet wired in. Wiring is straightforward — detect the party group, mount `<BillAllocationDrawer accountId={...} voucherAmount={...}>` under the line, persist allocations on submit by POSTing to `/api/finance/allocations` after the voucher creation succeeds.
- **2026-05-11 — Inventory–ledger coupling rule**: inventory items (qty × rate) only attach to lines whose ledger sits under the **Sales Accounts** or **Purchase Accounts** group — *any* ledger under either group qualifies (Sales A/c, Parts Revenue, Sales Returns, Purchase A/c, Purchase Returns, …). The line total = Σ(qty × rate) and posts as the ledger amount. **Stock direction follows the line's Dr / Cr posting side, not the ledger identity:** an inventory line on Dr → stock IN, on Cr → stock OUT. That is what makes reversals natural — the same Sales A/c moves stock OUT on Cr (sale) and IN on Dr (sales reversal); a Purchase A/c moves stock IN on Dr (purchase) and OUT on Cr (purchase reversal). Returns ledgers behave the same way — the side is the source of truth. All other vouchers post pure money / liability flows. **Exceptions:** Stock Journal and Physical Stock vouchers — they move stock without a sales / purchase ledger. Enforced both client-side (`isStockEligibleAccount` gates the "+ Inventory item" button) and server-side (`/api/accountancy/journal-vouchers` rejects with 422 if a stock line lands on any other ledger).
- **2026-05-12 — PurchaseDialog removed**: `src/store/purchaseDialogStore.ts` and its modal mount in `office/layout.tsx` were deleted. `/purchase` is now a standalone full-page route (same pattern as `/sale`). Any deep-link or "shortcut" that previously opened the dialog must point to `/purchase` instead. `/office/accountancy/purchases/new` redirects to `/purchase`.

## Out of scope / deferred

- GSTR returns, e-Invoice, RCM — deferred (see [tally_module_status memory](../../memory/tally_module_status.md)).
- Cost centres / budgets / multi-currency — cut.
- Renaming `/api/finance/*` to `/api/accountancy/*` — deferred to Step 5.

_Last updated: 2026-05-12 — added full-page trading voucher routes (/purchase, /sale-return, /purchase-return), SaleVoucherPage component, trading voucher workflow (item 9), extended postInvVoucherToGl to all four TradingKind values, removed PurchaseDialog gotcha._
