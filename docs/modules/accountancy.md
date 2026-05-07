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

- `src/modules/accountancy/components/` — `VoucherForm`, `VoucherList`, `VoucherDetail`, `LifecycleActions`, `BookPage`, `DrillRow`, `PartyCombobox`, `GstSummaryView` (folder renamed from `src/modules/tally/`).
- `src/modules/accountancy/lib/` — `balance.ts` (`isBalanced`, `nextRef`, `balanceDelta`), `period.ts` (`indianFiscalYearStart`, `formatDateInput`), `refResolver.ts`, `voucherLifecycle.ts` (shared cancel/delete helpers across Invoice/Payment/Voucher).

## Common workflows (wiring)

1. **Create sale invoice** — UI [src/app/(protected)/office/accountancy/sales/new/page.tsx](../../src/app/(protected)/office/accountancy/sales/new/page.tsx) → POST `/api/finance/invoices` → creates `Invoice` + `InvoiceLine[]` + (when status=SENT) auto-posts AR/Revenue `JournalEntry`.
2. **Create voucher (e.g. payment)** — `/office/accountancy/payments/new` → POST `/api/finance/vouchers` (validated against `isBalanced`) → DRAFT row, separately post via `/api/finance/vouchers/[id]/post`.
3. **Bill-wise allocation** — POST `/api/finance/allocations` linking any source voucher to any target (full or partial).
4. **Drill-down on ledger** — `/office/accountancy/ledgers/[id]` → reads from `/api/finance/reports/ledger/[accountId]`.

## Recent decisions / gotchas

- **2026-05-07 rename**: was `tally` → now `accountancy`. Folder, URL, permission area all changed. Sidebar label too. Compat redirect handles `/office/tally/*`. See [simplification_roadmap memory](../../memory/simplification_roadmap.md).
- **Step 4 partial state (2026-05-07)**: `Invoice.ticketId` is in the schema and code, but the DB migration is pending user consent. Until reset+seed, runtime queries that filter on `ticketId` will fail.
- **API folder still at `/api/finance/*`** — rename deferred to Step 5.

## Out of scope / deferred

- GSTR returns, e-Invoice, RCM — deferred (see [tally_module_status memory](../../memory/tally_module_status.md)).
- Cost centres / budgets / multi-currency — cut.
- Renaming `/api/finance/*` to `/api/accountancy/*` — deferred to Step 5.

_Last updated: 2026-05-07 — covers state after Step 1 rename + Step 4 schema/code edits (DB migration pending)._
