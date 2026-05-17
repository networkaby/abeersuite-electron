# Accountancy

> Full Tally-style accounting suite — chart of accounts, vouchers, invoices, payments, GL reports, GST hub. Renamed from "Tally" on 2026-05-07. Gated behind `accountancy:view:org` so only Owner / CA see it; everyone else's sidebar hides the section entirely.

## URLs

### UI pages (all gated by `src/app/(protected)/office/accountancy/layout.tsx`)
- `/office/accountancy` → `src/app/(protected)/office/accountancy/page.tsx`
- `/office/accountancy/dashboard` → `src/app/(protected)/office/accountancy/dashboard/page.tsx`
- `/office/accountancy/sales/new`, `/office/accountancy/sales/[id]` — detail / creation (list moved, see Vouchers Registers below)
- `/office/accountancy/purchases/new`, `/office/accountancy/purchases/[id]` — same
- `/office/accountancy/payments/new`, `/office/accountancy/payments/[id]`, and same shape for `/receipts`, `/contras`, `/credit-notes`, `/debit-notes`, `/estimates`, `/journal-entries`
- `/office/accountancy/invoices`, `/ledgers`, `/groups`, `/chart-of-accounts`, `/opening-balance`, `/account/[id]`
- **Vouchers Registers** (consolidated 2026-05-17) — `/office/accountancy/vouchers-registers/{all,sales,purchases,sale-returns,purchase-returns,estimates,payments,receipts,contras,credit-notes,debit-notes,journal-entries,sales-orders,purchase-orders,grn,challans,rejections-in,rejections-out,goods-receipts,issues,adjustments,stock-journals,physical-stock}`. `/all` renders the unified register via `useCombinedVouchers`; per-kind pages thin-wrap `VoucherList` / `InvVoucherList` / bespoke `*Register` components. The 5 read-only registers (goods-receipts/issues/adjustments/stock-journals/physical-stock) have no creation flow.
- `/office/accountancy/reports/{balance-sheet,profit-loss,trial-balance,day-book,cash-book,bank-book,receivables,payables,cash-flow,fund-flow,ratio-analysis,statistics,bank-reconciliation,ledger-outstandings/[ledgerId],optional-vouchers,pending-vouchers}`
- `/office/accountancy/reports/gst/{liability,outward-supplies,inward-supplies,hsn-summary,classification}`
- `/office/accountancy/reports/gst/classification` — **Tax Classification** master view. Four tabs: **Rate-wise** (every GstRate slab + "Unresolved" bucket with product counts; click → drills to Item-wise filtered by that rate), **HSN-wise** (products grouped by resolved HSN × rate; master-derived complement to HSN Summary, which is transaction-derived), **Group hierarchy** (InvProductGroup tree with inline-editable own GST/HSN/Taxability + "own" / "grp" / "org" source chips), **Item-wise** (every product with own + cascaded effective tax, inline-editable cells, pencil opens `InvProductDialog` directly on the Tax tab via the new `defaultTab` prop). Filters: search SKU/name, group, source ("own only" / "inherited from group" / "inherited from org default" / "unresolved"). Edit gated by `inventory:manage`.

Legacy `/office/tally/*` URLs 307-redirect to `/office/accountancy/*` via `next.config.ts`.

**Staff sidebar** (`MODULE_SECTIONS` in [src/utils/constants.ts](../../src/utils/constants.ts), rendered by [Sidebar.tsx](../../src/shared/components/Sidebar.tsx)): Accountancy expands to include **GST Reports** (hub `/office/accountancy/reports/gst`) with nested links — Outward Supplies, Inward Supplies, Net GST Liability, HSN Summary, Tax Classification. Visible to anyone with `accountancy:view:org` along with the rest of Accountancy.

### Full-page voucher creation pages (outside accountancy layout gate)

These routes live under `src/app/(protected)/vouchers/` — each opens in a new tab (button bar `window.open`) and has no office sidebar chrome. Auth check is in each route's `layout.tsx`.

**Trading + inventory vouchers** — all share `SaleVoucherPage` parameterised by `kind` (Vyapar-rich layout with item table, line disc/tax, totals strip):

| Route | Kind | Notes |
|---|---|---|
| `/vouchers/sale` | `SALE` | Sale Invoice — stock OUT, GL Cr Sales / Dr party. Accepts `?voucherId=<id>` for in-place edit. |
| `/vouchers/purchase` | `PURCHASE` | Purchase Invoice — stock IN, GL Dr Purchase / Cr party. Accepts `?voucherId=<id>` for edit. |
| `/vouchers/sale-return` | `SALE_RETURN` | Customer returns — stock IN, GL Dr Sales Returns / Cr party. Accepts `?voucherId=<id>` for edit. |
| `/vouchers/purchase-return` | `PURCHASE_RETURN` | Return to supplier — stock OUT, GL Dr party / Cr Purchase Returns. Accepts `?voucherId=<id>` for edit. |
| `/vouchers/estimate` | `ESTIMATE` | Quotation — same Vyapar shell, no GL post. |
| `/vouchers/sales-orders/new` | `SALES_ORDER` | Commitment — no stock, no GL. Parent-link picker offers PURCHASE_ORDER. |
| `/vouchers/purchase-orders/new` | `PURCHASE_ORDER` | Commitment — no stock, no GL. |
| `/vouchers/grn/new` | `GRN` | Goods Receipt Note — stock IN, no GL. Links to PURCHASE_ORDER. |
| `/vouchers/challans/new` | `CHALLAN` | Delivery Challan — stock OUT, no GL. Links to SALES_ORDER. `showPrices` toggle persists for print. |
| `/vouchers/rejections-in/new` | `REJECTION_IN` | Supplier rejection received — stock IN, no GL. |
| `/vouchers/rejections-out/new` | `REJECTION_OUT` | Goods returned to supplier — stock OUT, no GL. |

**Pure-GL vouchers** — share a single `layout.tsx` via the `(gl)` route group (`src/app/(protected)/vouchers/(gl)/layout.tsx`). Payment/Receipt/Contra/CreditNote/DebitNote use **`MoneyFlowVoucherPage`** (Tally-finish: compact top strip, two-column Particulars/Amount, Dr/Cr balance indicator, amount-in-words); Journal uses **`JournalVoucherPage`** (free-form Dr/Cr per row, auto-balance gating Save, optional stock attachment per line):

| Route | Kind / Component | Notes |
|---|---|---|
| `/vouchers/payment` | `PAYMENT` / `MoneyFlowVoucherPage` | Cr Cash/Bank top; Dr expense/party rows. |
| `/vouchers/receipt` | `RECEIPT` / `MoneyFlowVoucherPage` | Dr Cash/Bank top; Cr party/income rows. |
| `/vouchers/contra` | `CONTRA` / `MoneyFlowVoucherPage` | Both sides Cash/Bank — inter-account transfer. |
| `/vouchers/credit-note` | `CREDIT_NOTE` / `MoneyFlowVoucherPage` | Party top via `PartySearchAndCreate` (Sundry Debtors). |
| `/vouchers/debit-note` | `DEBIT_NOTE` / `MoneyFlowVoucherPage` | Party top via `PartySearchAndCreate` (Sundry Creditors). |
| `/vouchers/journal` | — / `JournalVoucherPage` | Free-form Dr/Cr table; Save disabled until balanced. |

### API routes (all under `src/app/api/finance/`)
- List/read endpoints (~30 files) gated by `requirePermission("accountancy:view:org")` — invoices, journal-entries, vouchers, ledgers, gl-accounts, account-groups, opening-balance, allocations, all `reports/*`.
- Operation endpoints (cancel/delete/post/restore) keep their fine-grained `finance:*:*` keys (e.g. `finance:invoice:cancel`, `finance:voucher:post`).
- `GET /api/accountancy/reports/gst-classification` — single batched payload for the Tax Classification page. Returns `{ rates[], groups[], products[], orgDefaults, summary }` with every product + group cascade-resolved in one round-trip via `resolveProductTaxBatch`. Permission: `accountancy:view:org`.

API folder is still `/api/finance/*` — rename deferred to Step 5 (route restructure).

## Permissions (gate keys)

- `accountancy:view:org` — module-level gate. Hides sidebar section + redirects on direct nav + 403 on API. See [permission_matrix memory](../../memory/permission_matrix.md).
- `finance:invoice:cancel` / `delete` / `hard-delete` — three-tier invoice lifecycle.
- `finance:journal:cancel` / `delete` / `hard-delete` — three-tier journal lifecycle.
- `finance:payment:cancel` / `delete` / `hard-delete` — three-tier payment lifecycle.
- `finance:voucher:create` / `post` / `cancel` / `delete` / `hard-delete` — Tally-style voucher lifecycle (Contra / Payment / Receipt / Credit Note / Debit Note).
- `finance:allocation:manage` — bill-wise allocation (links any voucher to any other for outstandings + aging).
- `finance:opening-balance:manage` — edit per-account opening balances at books-beginning date.

## Voucher taxonomy (canonical)

Every voucher in the system falls into exactly one of four classes. Day Book, Optional Vouchers, and Pending Vouchers reports all share this mental model.

### 1. Optional — no stock, no GL impact
Pure documents / commitments. Belongs to CRM / planning.
- `ESTIMATE`, `SALES_ORDER`, `PURCHASE_ORDER`
- Quotation, Proforma Invoice (when added)
- **Any voucher in DRAFT status** — regardless of `type`, drafts never post.

### 2a. Inventory-only, complete cycle — moves stock, no GL, self-contained
No follow-up needed.
- `ADJUSTMENT`, `STOCK_JOURNAL`, `PHYSICAL_STOCK`

### 2b. Inventory-only, in-flight — moves stock, no GL, **needs settlement**
Surfaced by the Pending Vouchers report. Settled only via another inventory-moving voucher (category 2b or 4); GL-only adjustments (CREDIT_NOTE / DEBIT_NOTE) do **not** settle these:

| Voucher | Settled by |
|---|---|
| `CHALLAN`       | `SALE` or `REJECTION_IN` |
| `GRN`           | `PURCHASE` or `REJECTION_OUT` |
| `REJECTION_IN`  | `CHALLAN` (replacement out) or `SALE_RETURN` |
| `REJECTION_OUT` | `GRN` (replacement in) or `PURCHASE_RETURN` |

Settlement is detected via the `InvVoucher.refReturns` back-relation (downstream voucher sets `refVoucherId = source.id`). `ISSUE` is currently unused.

### 3. GL-only — moves ledger money, no stock
Writes to `Voucher` model only.
- `PAYMENT`, `RECEIPT`, `CONTRA`
- `CREDIT_NOTE` — price/refund adjustment for customer (no stock)
- `DEBIT_NOTE` — price/claim adjustment for supplier (no stock)
- `JOURNAL` (`JournalEntry` model) — generic GL entry: depreciation, accruals, opening balances

### 4. Full voucher — moves stock **and** posts to GL in one step
Writes both `InvVoucher` and `Voucher`. Self-contained.
- `SALE` — via `/vouchers/(gl)/sales/new` (regular invoice) or `/vouchers/pos/new` (POS fast-path; same `type=SALE`, requires open shift)
- `PURCHASE`, `SALE_RETURN`, `PURCHASE_RETURN`

### Often-confused pairs

| Pair | Stock | GL | When to use |
|---|---|---|---|
| `SALE_RETURN` (full)        | Stock IN  | Reverses revenue / AR | Customer returned physical goods |
| `CREDIT_NOTE` (GL-only)     | —         | Credits customer      | Price correction / discount / refund without goods change |
| `PURCHASE_RETURN` (full)    | Stock OUT | Reverses expense / AP | We returned physical goods to supplier |
| `DEBIT_NOTE` (GL-only)      | —         | Debits supplier       | Claim / price correction without goods movement |

## Prisma models (file: `prisma/schema/finance.prisma`)

- `JournalEntry` + `JournalLine` — double-entry GL.
- `Invoice` + `InvoiceLine` + `InvoiceAudit` — sales invoices. **`Invoice.ticketId`** is the new soft back-link to the repair ticket (added Step 4, 2026-05-07; replaces deprecated `TicketPart`).
- `Voucher` + `VoucherLine` — Contra / Payment / Receipt / Credit Note / Debit Note.
- `Payment` + `PaymentAllocation` — payments + bill-wise links.
- `Account` (in `prisma/schema/customers.prisma`) — dual-purpose GL account + customer/company ledger.
- `OpeningBalance` — per-account books-beginning balances.

## Key components / library

- `src/modules/accountancy/components/` — `VoucherForm`, `VoucherList`, `VoucherDetail`, `LifecycleActions`, `BookPage`, `DrillRow`, `PartyCombobox`, `GstSummaryView`. Dialog components (`JournalVoucherDialog`, `DebitNoteDialog`, `ContraDialog`, `MoneyFlowDialog`, `EstimateDialog`, etc.) remain mounted in `office/layout.tsx` and are still reachable via their `/new` redirector routes — they are no longer wired into the button bar (which now opens the full-page routes instead).
- **`SaleVoucherPage`** (`src/modules/accountancy/components/SaleVoucherPage.tsx`) — single parameterised full-page form for all 11 `TradingKind` values (`SALE | PURCHASE | SALE_RETURN | PURCHASE_RETURN | ESTIMATE | SALES_ORDER | PURCHASE_ORDER | GRN | CHALLAN | REJECTION_IN | REJECTION_OUT`). Driven by a `PER_KIND` config map. Features: CASH / CREDIT mode toggle (trading kinds only), line-item table (qty / rate / line discount / tax), overall discount, round-off, payment terms, cash/bank ledger picker, parent-voucher picker (`ParentVoucherPicker`), estimated-profit panel. Column prefs persisted to `localStorage`.
- **`MoneyFlowVoucherPage`** (`src/modules/accountancy/components/preview/MoneyFlowVoucherPage.tsx`) — Tally-finish full-page form for 5 pure-GL kinds: `PAYMENT | RECEIPT | CONTRA | CREDIT_NOTE | DEBIT_NOTE`. Per-kind config (`COPY`) drives labels, Dr/Cr sides, account filters. Layout: compact top strip → top-side account line → two-column Particulars/Amount table → Dr/Cr balance totals → narration + amount-in-words → sticky footer (Cancel · Save Draft · Save). POSTs to `/api/accountancy/vouchers`.
- **`JournalVoucherPage`** (`src/modules/accountancy/components/preview/JournalVoucherPage.tsx`) — Tally-finish free-form Dr/Cr journal. Per-row Dr/Cr toggle; two amount columns (Debit | Credit). `isBalanced()` gates Save. Optional stock attachment per row when `isStockEligibleAccount`. POSTs to `/api/accountancy/journal-vouchers`.
- **`numberToIndianWords`** (`src/shared/lib/format/numberWords.ts`) — Indian crore/lakh amount-in-words ("Rupees Five Thousand Only"). Used by `MoneyFlowVoucherPage` and `JournalVoucherPage`.
- `src/modules/accountancy/lib/` — see helpers registry below.

## Reusable helpers — DO NOT duplicate ⚠️

These are the **single source of truth** for every balance/value calculation in the app. Before writing new SUM logic, opening-folding logic, or inline `balance + opening` math, **search this list first**. Adding a new call site = one import; reproducing the math inline causes drift between reports and drilldowns (we hit this twice in 2026-05-09).

| Helper | File | Purpose | Use when |
|---|---|---|---|
| `balanceDelta(normalBalance, entryType, amount)` | `src/modules/accountancy/lib/balance.ts` | Sign-corrected GL delta for a posting | Updating `Account.balance` on voucher post; folding opening into running balance |
| `isBalanced(lines)` | same | True iff Σ debits == Σ credits within tolerance | Voucher pre-flight before save/post |
| `toNumber(v)` | same | Prisma Decimal / string → number | Reading any `Decimal` field in JS |
| `nextRef(tx, model, prefix)` | same | Sequential reference (`PV-2026-0001`) | Generating voucher / JE references inside a transaction |
| **`postContra(tx, { date, narration, lines, userId })`** | `src/modules/accountancy/lib/postContra.ts` | Atomic create-and-post for a CONTRA Voucher + mirror JE + balance deltas. Returns `{ voucherId, journalEntryId, reference }`. | Any system-generated cross-cash-account transfer — POS shift open/close handover, future inter-branch transfers, payroll cash handover. **DRY for Contra construction in non-dialog code paths.** The user-facing Contra dialog still uses the two-step `POST /api/accountancy/vouchers` → `/[id]/post` flow because it goes through DRAFT first; the helper is for "create and post immediately." |
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
| `useCombinedVouchers()` | `src/modules/accountancy/hooks/useCombinedVouchers.ts` | Client hook that fans out to the three voucher GET APIs (`/api/inventory/vouchers`, `/api/accountancy/vouchers`, `/api/accountancy/journal-entries`) in parallel and normalises into a single `CombinedRow[]` sorted by date desc. Source-aware `detailHref` per row. Filtering is the caller's responsibility (no server-side pagination — fine up to a few thousand rows). | The `/office/accountancy/vouchers-registers/all` page and any future cross-kind voucher listing. **Do not roll your own multi-API combiner** — extend this hook instead. |
| `VoucherList` | `src/modules/accountancy/components/VoucherList.tsx` | Generic register for the GL `Voucher` table; filters by `type` and hits `/api/accountancy/vouchers`. Status tabs, paginated rendering, optional New button. | Any GL voucher register (Payment/Receipt/Contra/Credit Note/Debit Note). |
| `InvVoucherList` | `src/modules/inventory/components/InvVoucherForm.tsx` (named export) | Generic register for the `InvVoucher` table; filters by `type` and hits `/api/inventory/vouchers`. Accepts the broader `InvVoucherListKind` (incl. RECEIPT/ISSUE/ADJUSTMENT). Empty `basePath` hides the chevron; omit `newPath` to hide the New button. | Any inventory voucher register — including the five read-only kinds with no creation flow. |

### Architectural rule

`Account.balance` is a **transaction-only running cache** updated by post handlers. **Never display it directly** — always pass through `effectiveLedgerBalance()` so the opening balance is folded in. The four endpoints that previously read `balance` raw (chart of accounts, group detail, account-groups tree, account detail) all wrap it now; new endpoints must too.

## Common workflows (wiring)

1. **Create sale invoice** — UI [src/app/(protected)/office/accountancy/sales/new/page.tsx](../../src/app/(protected)/office/accountancy/sales/new/page.tsx) → POST `/api/finance/invoices` → creates `Invoice` + `InvoiceLine[]` + (when status=SENT) auto-posts AR/Revenue `JournalEntry`.
2. **Create voucher (e.g. payment)** — Button bar "Payment +" → `window.open("/vouchers/payment")` → `MoneyFlowVoucherPage` (Tally-finish full-page form) → POST `/api/accountancy/vouchers`. Legacy route `/office/accountancy/payments/new` still opens the old `MoneyFlowDialog`.
3. **Bill-wise allocation** — POST `/api/finance/allocations` linking any source voucher to any target (full or partial).
4. **Drill-down on ledger** — `/office/accountancy/ledgers/[id]` → reads from `/api/finance/reports/ledger/[accountId]`.
5. **Tally-style journal voucher (with optional inventory)** — Button bar "Journal +" → `window.open("/vouchers/journal")` → `JournalVoucherPage` (Tally-finish full-page form) → POST `/api/accountancy/journal-vouchers` (atomic: Voucher + JE + Account.balance + optional STOCK_JOURNAL InvVoucher carrier + InvStockLedger). Inventory items are gated to INCOME/EXPENSE ledgers via `isStockEligibleAccount`. Legacy `JournalVoucherDialog` (opens via `useJournalVoucherStore`) still mounted in `office/layout.tsx`.
6. **Set opening balance on master save** — POST/PATCH `/api/finance/gl-accounts` (writes `openingBalance/openingBalanceType/openingBalanceDate` directly) and POST/PATCH `/api/inventory/products` (also syncs `stock`/`costPaise` cache via `syncProductCacheFromOpening`). The `/office/accountancy/opening-balance` page exposes both inline + dedicated quick-create dialogs.
7. **Create debit note** — Button bar "Debit Note +" → `window.open("/vouchers/debit-note")` → `MoneyFlowVoucherPage kind="DEBIT_NOTE"` → POST `/api/accountancy/vouchers`. Legacy `/office/accountancy/debit-notes/new` still opens `DebitNoteDialog`.
8. **Create contra** — Button bar "Contra +" → `window.open("/vouchers/contra")` → `MoneyFlowVoucherPage kind="CONTRA"` — both sides restricted to Cash-in-Hand / Bank Accounts. Legacy `/office/accountancy/contras/new` still opens `ContraDialog`.
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
- **2026-05-12 — Trading voucher edit-in-place (preserves reference)**: All four trading voucher form pages (`/sale`, `/purchase`, `/sale-return`, `/purchase-return`) accept `?voucherId=<id>`. The form fetches + prefills the voucher and PATCHes on save. **The voucher reference number is preserved across edits** — same row, same `id`, same `reference`. Server-side PATCH handles both states: DRAFT edits are a plain update; **POSTED edits run reverse → apply → re-post in one transaction** (reverses original stock ledger + cached stock, posts a reversal JE + cancels the original JE for audit, replaces lines + header, then re-posts via `postInvVoucherToGl`). Cancelled / deleted vouchers return 409 ("use Duplicate to make a fresh copy"). The form shows an amber pill `"Posted — edit reposts on save"` when editing a POSTED voucher so the user knows the implications.

## Thermal print (voucher)

Voucher detail pages (`VoucherDetail.tsx`) have a **Print** button that sends the voucher directly to a LAN thermal printer with no browser dialog.

### Architecture
Because the Next.js app is cloud-hosted, the server cannot reach a local LAN printer. Printing is **client-initiated**: the browser calls a tiny local relay script running on the shop PC, which forwards ESC/POS commands to the printer over TCP.

```
Browser → http://localhost:9191/print → tools/thermal-relay/relay.js → Printer IP:9100
```

### Setup (shop PC)
1. Copy `tools/thermal-relay/` to the shop PC.
2. Edit `config.json` — set `printerIp` to the printer's LAN IP.
3. `npm install` (once), then `node relay.js` (or add to Windows startup via Task Scheduler / pm2).

### Relay endpoints
| Method | Path | Purpose |
|---|---|---|
| `GET` | `http://localhost:9191/health` | Liveness check — called before every print job |
| `POST` | `http://localhost:9191/print` | Accepts voucher JSON, builds ESC/POS, sends to printer |

### Print payload (sent by browser)
```jsonc
{
  "reference": "PV-2026-0001",
  "date": "2026-05-17T...",
  "type": "PAYMENT",
  "party": "XYZ Ltd",          // null if no partyAccount
  "narration": "...",           // null if absent
  "lines": [
    { "accountName": "Cash", "type": "CREDIT", "amount": 10000, "description": null }
  ],
  "totalDebit": 10000,
  "totalCredit": 10000,
  "status": "POSTED",
  "createdBy": "Admin"
}
```

### Files
- `tools/thermal-relay/relay.js` — Express server, ESC/POS builder, TCP sender
- `tools/thermal-relay/package.json` — deps: `express`, `cors`, `node-thermal-printer`
- `tools/thermal-relay/config.json` — local config (gitignored; never commit printer IP)
- `tools/thermal-relay/README.md` — full setup guide
- `src/modules/accountancy/components/VoucherDetail.tsx` — Print button + `handlePrint`

## Out of scope / deferred

- GSTR returns, e-Invoice, RCM — deferred (see [tally_module_status memory](../../memory/tally_module_status.md)).
- Cost centres / budgets / multi-currency — cut.
- Renaming `/api/finance/*` to `/api/accountancy/*` — deferred to Step 5.

- **2026-05-13 — Full-page GL voucher routes (team-approved)**: `MoneyFlowVoucherPage` and `JournalVoucherPage` are now permanently mounted at `/vouchers/{payment,receipt,contra,credit-note,debit-note,journal}` and `/vouchers/estimate`. They share a single `layout.tsx` via the `(gl)` route group. Button bar entries for all 7 kinds now `window.open()` those routes instead of triggering the legacy dialogs. The old dialog components (`MoneyFlowDialog`, `JournalVoucherDialog`, `EstimateDialog`, etc.) remain mounted in `office/layout.tsx` and reachable via `/office/accountancy/{payments,receipts,contras,credit-notes,debit-notes,estimates}/new` — they are not deleted, just no longer the primary entry point.

- **2026-05-16 — Tax Classification report shipped**: new master-data view at `/office/accountancy/reports/gst/classification` with four tabs (Rate-wise / HSN-wise / Group hierarchy / Item-wise). All four read from a single new endpoint `GET /api/accountancy/reports/gst-classification` that returns the entire catalog cascade-resolved in 3 SQL queries (products + groups + orgDefaults) via `resolveProductTaxBatch` in `gstResolver.ts`. Inline-edit cells on Group hierarchy + Item-wise tabs PATCH directly to `/api/inventory/product-groups/[id]` and `/api/inventory/products/[id]` (gated by `inventory:manage`). Per-row pencil on Item-wise opens the full `InvProductDialog` directly on the Tax tab via new `defaultTab` prop (also threaded into `InvProductFormFields`). Page added as a 5th card on the GST hub.

_Last updated: 2026-05-17 — Thermal print added: `VoucherDetail` now has a Print button that routes through a local relay script (`tools/thermal-relay/`) to an ESC/POS LAN printer — no browser dialog, no port forwarding. Previously (2026-05-16): Tax Classification report shipped; GST Reports submenu added to sidebar._
