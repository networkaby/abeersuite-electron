# PROJECT BRAIN — ServiceMgmt

> Internal service management system for an electronics repair shop — tracking tickets, team handoffs, and customer communication across Front Desk, Technician, Despatch, and Admin roles.

**Stack:** Next.js 16.2.3 (App Router, Turbopack), React 19, PostgreSQL (Supabase), Prisma 7.7.0 (split schema), NextAuth v5 beta (JWT), Tailwind v4, shadcn/ui, Zustand 5, Sonner (toasts), Axios, React Hook Form, Zod, Razorpay (payments), Cloudinary (uploads), Sentry  
**Repo:** `D:\our-own-website\service-mgmt-experiment` (local, git branch: `dev`)  
**Started:** 2026-04-17  
**Last Updated:** 2026-05-14

---

## 📌 Source of Truth

- `README.md` — setup and day-to-day runbook.
- `AGENTS.md` — rules every agent / contributor must read before making changes (DRY, module-doc-first, completed-and-protected, seed sync, post-segment doc updates).
- `ARCHITECTURE.md` — current implementation architecture (modules, route groups, auth/data boundaries).
- `docs/modules/<module>.md` — per-module template: URLs (UI + API), Permissions, Prisma models, Key components, Common workflows, Reusable helpers, Gotchas. Index: `docs/modules/README.md`.
- `docs/reusables.md` — cross-cutting registry of every helper / hook / schema / formatter / shared component in `src/shared/`. Adding shared surface area requires same-commit registry update.
- `docs/completed-and-protected.md` — features whose behaviour is guarded. Refactors/restyling fine; behaviour changes need explicit user approval. Always read before touching POS, Balance Sheet, P&L, Day Book, sale return, etc.
- `docs/seeds.md` — single source of truth for the seed lifecycle (`bootstrap-seed.ts` for prod, `dummy-*.ts` for demo, `hard-clean.ts` for reset).
- `PROJECT_BRAIN.md` — milestone history, roadmap, decision log, ideas, gotchas.

---

## 🎯 Goal

Replace paper/spreadsheet job tracking at the repair shop with a real internal tool. Every ticket moves through a defined workflow (Received → Diagnosing → Repairing → … → Returned). Each role (Front Desk, Technician, Despatch, Admin) sees only their relevant work. Sub-statuses communicate team handoffs. Long-term: evolve into a full ERP/CRM platform for the office.

---

## 🏁 Milestones

| # | Milestone | Status | Completed |
|---|-----------|--------|-----------|
| 1 | Core ticket flow (create, view, status transitions) | ✅ Done | 2026-04-17 |
| 2 | Sub-status system + notifications | ✅ Done | 2026-04-18 |
| 3 | Role-based access + role dashboards | ✅ Done | 2026-04-18 |
| 4 | Multi-role + Permission Foundation (Phase 1) | ✅ Done | 2026-04-19 |
| 5 | Warranty System (Phase 2) | ✅ Done | 2026-04-19 |
| 6 | Task System (Phase 3) | ✅ Done then Removed | 2026-04-19 → removed 2026-04-21 |
| 7 | Cross-User Delegation + UX polish (Phase 4) | ✅ Done | 2026-04-19 |
| 8 | ERP Module Foundation (Phase 5) | ⏳ Archived — implement later | — |
| 9 | Assignment & Ownership System | ✅ Done | 2026-04-21 |
| 10 | Permission-based auth + API hardening | ✅ Done | 2026-04-23 |
| 11 | Pipeline System + CRM Foundation | ✅ Done | 2026-04-24 |
| 12 | Reporting & Analytics (Tally side) | ✅ Done | 2026-05-07 |
| 13 | External Shop + Customer Portal | ✅ Done | 2026-05-02 |
| 14 | Social / Staff Profiles + Call Log | ✅ Done | 2026-05-02 |
| 15 | Ecommerce Admin + Org Chart | ✅ Done | 2026-05-02 |
| 16 | CRM Lead Management | ✅ Done | 2026-05-04 |
| 17 | Inventory unification — ShopProduct → InvProduct + voucher models | ✅ Done | 2026-05-04 |
| 18 | Tally Phase 4 — Account groups, ledgers, estimates, journal lifecycle, opening balances + suspense | ✅ Done | 2026-05-05 |
| 19 | Accountancy Phase 5a — Reports hub, GST hub w/ HSN, Party CRM | ✅ Done | 2026-05-07 |
| 20 | Tally → Accountancy rename + simplification cleanup (Steps 0–4 + DB reset/reseed) | ✅ Done | 2026-05-07 |
| 21 | Inventory module overhaul — naming convention, attribute masters, attrsJson, configure nav split | ✅ Done | 2026-05-13 |
| 22 | Multi-branch inventory — full transaction-level implementation | ✅ Done | 2026-05-13 |
| 23 | POS foundation — multi-staff shift lifecycle + close AR on cash POS sales | ✅ Done | 2026-05-14 |
| 24 | POS shift discipline — counter-based tills, session-independent shifts, two-step handover, closing report, quick-fill ticks | ✅ Done | 2026-05-14 |
| 25 | POS sale return — three-tier lookup (by invoice #, by customer, lost-invoice manager bypass) | ✅ Done | 2026-05-14 |
| 26 | POS sidebar navigation + lint/build green | ✅ Done | 2026-05-14 |

> **Current Milestone:** No active milestone — POS sale return shipped. Likely next: Accountancy Phase 5b (GSTR-1/3B, e-Invoice IRN, RCM — deferred), POS receipt print pages, or repair-side reporting dashboard.

---

## ✅ Completed Work

### 2026-05-14 — Lint + build cleanup (Milestone 26)

- **21 lint errors → 0 errors** (36 non-blocking warnings remain).
  - `react/no-unescaped-entities` (apostrophes) fixed in `office/admin/naming-convention/page.tsx` and `office/admin/year-ending/page.tsx`.
  - `react-hooks/set-state-in-effect`: added inline `// eslint-disable-next-line` on the exact offending `setState`/loader call (not on the `useEffect` line — `eslint-disable-next-line` only disables the line directly after it) in: `office/inventory/products/page.tsx`, `office/inventory/stock-summary/page.tsx`, `office/pos/shifts/page.tsx`, `office/repairing/tickets/page.tsx`, `shared/components/FinanceTopBar.tsx`, `shared/hooks/useApiResource.ts`, `shared/hooks/useComboboxNav.ts`, `shared/hooks/usePartySearch.ts`.
  - `react-hooks/refs` violations: file-level `/* eslint-disable react-hooks/refs */` with an explanatory header on `GlAccountCombobox.tsx` (forwards refs from `useComboboxNav` hook) and `InvProductFormFields.tsx` (reads `.current` of dirty-flag refs in JSX for hint gating). JSX comment `{/* eslint-disable-next-line */}` doesn't reach attribute-level violations, so file-level is the practical fix.
  - `react-hooks/immutability` suppressed in `InvProductCombobox.tsx:230`.
- **Build fix**: All 6 non-`(gl)` voucher `/new` pages were failing prerender — `SaleVoucherPage` calls `useSearchParams()`, and the `(gl)/layout.tsx` forces dynamic via `await auth()` for its pages, but the non-`(gl)` ones had no parent layout doing that → Next tried to statically prerender and bailed out. Added `export const dynamic = "force-dynamic"` to: `vouchers/challans/new`, `vouchers/grn/new`, `vouchers/purchase-orders/new`, `vouchers/rejections-in/new`, `vouchers/rejections-out/new`, `vouchers/sales-orders/new`.
- **`pnpm build` → exit 0**; all `/vouchers/*/new` pages now render as `ƒ` (Dynamic, server-rendered on demand).
- Commit: `fe396c8`.

### 2026-05-14 — POS sidebar navigation + SessionProvider fix (Milestone 26)

- **POS section added to `MODULE_SECTIONS`** (`src/utils/constants.ts`):
  - "POS Register" → `/vouchers/pos`, opens in new tab (`newTab: true`), permission `pos:shift:open`.
  - "Shift Reports" → `/office/pos/shifts`, opens in same window, permission `pos:shift:view:branch`.
  - Section hidden unless user holds `pos:shift:open`.
- **New `newTab?: boolean` prop on `ModuleChild`** type — sidebar's `renderModuleChildren` renders `<a target="_blank" rel="noopener noreferrer">` when set, falling back to `<Link>` otherwise.
- **SessionProvider fix** for `/vouchers/pos` runtime error: `PosReturnDialog` calls `useSession()`, but the standalone POS layout at `src/app/(protected)/vouchers/pos/layout.tsx` was a minimal shell (no office sidebar) and never wrapped children in `<SessionWrapper>`. Added the wrapper — the layout already validates the session server-side via `auth()`, so adding the client `SessionProvider` is safe. Mirrors the office layout pattern exactly.
- Commits: `c3449f8` (sidebar nav), `632ca44` (SessionWrapper fix).

### 2026-05-14 — POS sale return flow with three-tier lookup (Milestone 25)

Customers bring goods back to the counter. Three lookup tiers, all routed through the same `PosReturnDialog`. GL: `Dr Sales Revenue / Cr Counter Till` (CASH refund — requires OPEN shift) or `Dr Sales Revenue / Cr Customer AR` (credit note). Stock: `SALE_RETURN InvVoucher` + `InvStockLedger` IN row + `InvProductBranch.stock` / `InvProduct.stock` increment.

- **Schema (`prisma/schema/finance.prisma`)**:
  - `Invoice.returnOfId Int?` self-FK + `returnOf` / `returns` relations — credit-note invoice links back to original sale invoice.
  - `InvoiceLine.productId Int?` — POS sale stores this so a return can trace which product to put back in stock.
  - `@@index([productId])` on `InvoiceLine`.
- **Schema (`prisma/schema/inventory.prisma`)**: `InvProduct.invoiceLines InvoiceLine[] @relation("InvoiceLineProduct")` reverse relation.
- **`POST /api/pos/sale`** updated to store `productId` on each `InvoiceLine` (so future returns can match by line).
- **`GET /api/pos/return/search`** — two modes returning the same `FoundInvoice[]` shape:
  - `?q=INV-…` (invoice-number substring, default cashier flow)
  - `?customerId=N` (all PAID, non-return invoices for that account)
  - Permission: `pos:shift:open`.
- **`POST /api/pos/return`** — standard cashier return. Body `{ originalInvoiceId, lines: [{invoiceLineId, qty}], refundMode: "CASH"|"CREDIT", notes? }`. Validates qty ≤ original. Atomic `$transaction`: creates negative-amount return Invoice with `returnOfId` set, posts the GL JE, creates `SALE_RETURN InvVoucher` with `refVoucherId` pointing to the original SALE voucher, restores stock. Permission: `pos:shift:open`.
- **`POST /api/pos/return/lost`** — manager-only lost-invoice bypass. Body `{ customerAccountId, lines: [{productId, qty, unitPrice, taxRate}], refundMode, reason }` (reason min 5 chars). Same GL + stock path; `returnOfId: null`, `refVoucherId: null`, notes prefixed with `[LOST INVOICE]`. Customer is required (walk-ins blocked). Permission: `pos:shift:manage`.
- **`PosReturnDialog`** (`src/modules/pos/components/PosReturnDialog.tsx`) — three tabs:
  - **By invoice #**: cashier types `INV-…`, picks result, line-level qty picker, refund mode toggle (Cash back / Credit note).
  - **By customer**: `PartySearchAndCreate` picks a debtor, fetches their PAID invoices, same line-level picker.
  - **Lost invoice** (manager only, hidden unless `pos:shift:manage` in session): `PartySearchAndCreate` + free-form product picker + qty / price / tax inputs + mandatory reason textarea, amber styling, submits to `/lost`.
  - Shared `InvoiceResultList` + `RefundModeToggle` subcomponents.
- **`PosScreen`**: `Return` button (`RotateCcw` icon) added to the top bar; `<PosReturnDialog>` mounted alongside other dialogs.
- **Docs**: `docs/modules/pos.md` got a "Sale Return" section + three-tier table + reusable-helpers entry for `PosReturnDialog`; `docs/reusables.md` updated; `docs/completed-and-protected.md` marks the GL math as protected.
- Commits: `73d2ecc` (return flow), `8297530` (protected-surface doc).

### 2026-05-14 — POS shift discipline + counter-based tills (Milestone 24)

The cash till GL account belongs to the **physical counter**, not the cashier. Any cashier can work any counter; variance hits the counter account and human accountability comes from the shift report. Same-user crash recovery: if the browser dies mid-shift, the same user can reopen and **resume** the existing shift at the same counter (HTTP 200 with `resumed: true`) instead of being blocked by a 409.

- **Removed `PosCounter.defaultFloatPaise`** from schema + all 7 touching surfaces (counters CRUD API, ShiftOpenDialog, ShiftCloseDialog, /office/admin/counters page, bootstrap seed, etc.). Counters no longer carry a "default float" — operators decide opening float at shift-open time.
- **Session-independent shifts**: `POST /api/pos/sale` and `GET /api/pos/shifts/current` no longer filter by the session's active-branch cookie. Branch context is read directly from `shift.branchId` (the shift the cashier opened) — lets two browsers on the same user bill in parallel from different counters without the active-branch cookie interfering.
- **Crash recovery**: `POST /api/pos/shifts` — same user + OPEN at the same counter returns the existing shift with `resumed: true` (HTTP 200, not 409). Same user + AWAITING_HANDOVER returns 409 with a specific message. Different user always returns 409 "Counter in use by another cashier".
- **Shift closing report**: `ShiftCloseDialog` now captures the API response, swaps the form for a full reconciliation report (date, counter/branch, duration, opening / sales / drops / expected / declared / variance color-coded, disposition, GL refs, notes). Print via `window.open()` with monospace CSS. Layout: `flex flex-col max-h-[90vh]` + `flex-1 overflow-y-auto` so the footer button never gets covered.
- **Quick-fill ticks** on checkout: a green ✓ tick next to Cash and UPI rows fills the remaining amount, eliminating credit-into-AR when the customer pays exact change or splits cleanly across two methods.
- **BigInt serialisation gotcha**: never spread `...shift` in JSON responses; always pick explicit fields and call `.toString()` on BigInt columns.
- Commit: `8edde20`.

### 2026-05-14 — POS foundation: multi-staff shift lifecycle (Milestone 23)

- **`PosShift` model** — cashier session at a `PosCounter`. Status: OPEN → AWAITING_HANDOVER → CLOSED. Carries `carryOverFloatPaise`, `vaultTopUpPaise`, `carryOverNextPaise`, `toVaultPaise`. Self-relation `handoverToShiftId` for the audit chain.
- **`PosCashDrop`** mid-shift log (no GL).
- **`PosHandover`** — two-step record. `fromShiftId`, `toUserId`, `toShiftId` (filled on accept). PENDING → ACCEPTED / CANCELLED.
- **`Branch.vaultAccountId`** — per-branch vault, auto-created by the bootstrap seed.
- **AR closed on cash POS sale**: a parallel cash-receipt JE posts `Dr Cash/Bank / Cr AR` in the same atomic transaction as the sale, so AR doesn't linger on cash sales.
- **Pages**: `/office/pos/shifts` (shift report — variance / drops / handover chain), `/office/pos/shifts/[id]` (shift audit), `/office/admin/counters` (counter CRUD with till GL auto-creation).
- **`PosCounter`** — physical billing station. `tillAccountId` (Account), `branchId`, unique on `(branchId, name)`.
- **Variance ledgers**: `Cash Short` (6950) and `Cash Over` (4950) seeded by bootstrap.
- **Two-step cashier handover**: A initiates → shift → AWAITING_HANDOVER (no GL yet); B logs in, accepts via `HandoverAcceptDialog`; server runs one transaction (variance JE + Contra Counter→Vault + close A's shift + open B's shift).
- **`postContra`** helper (`src/modules/accountancy/lib/postContra.ts`) — atomic Contra voucher + JE + balance deltas. Used for vault top-up + vault sweep on close.
- **`postPosReceiptJe`** helper (`src/modules/pos/lib/postPosReceiptJe.ts`) — settles AR on POS cash sales.
- **`shiftMath`** (`src/modules/pos/lib/shiftMath.ts`) — BigInt paise arithmetic (`computeExpectedCash`, `computeVariance`, `sumPaise`).
- **`ActiveShiftBar`** top strip on PosScreen (OPEN: sales/drops/drawer + Drop/Close; AWAITING_HANDOVER: amber strip + Cancel Handover).
- Commit: `e18a479`.

### 2026-05-13 — Multi-branch inventory: full transaction-level implementation (Milestone 22)

- **Branch column on every voucher list** + per-branch stock breakdown on product detail.
- **`InvProductBranch`** model — per-branch stock cache (productId + branchId → stock); incremented/decremented atomically alongside `InvStockLedger` writes.
- **`InvStockLedger.branchId`** required on every ledger entry — branch is now a first-class dimension of the stock journal.
- Stock summary page rolls up multi-branch, with per-branch drill-down.
- Commit: `b3633df`.

### 2026-05-13 — Inventory module overhaul (Milestone 21)

- **Naming convention** (`/office/admin/naming-convention`): admin-configurable rule chain for auto-generating product names + slugs from attributes. Tokens like `{brand} {model} {capacity}` walk a fallback chain when source fields are empty; the auto-fill flips to manual the moment the user types.
- **Attribute masters**: brand, model, category, unit, warranty term, etc., each with their own admin CRUD pages under `/office/inventory/masters/`.
- **`InvProduct.attrsJson`** — flexible JSON column for product attributes that don't justify their own column (helps the naming-convention engine).
- **Configure nav split**: `/office/inventory/masters/` (per-attribute CRUD) vs `/office/inventory/configure/` (engine-level config: naming convention, stock methods, year-ending).
- Auto-fill hints in `InvProductFormFields` use `nameDirty` / `onlineNameDirty` / `slugDirty` refs to gate "Auto-filled from naming convention. Type to override." hint text (lint disabled file-wide for `react-hooks/refs`).

### 2026-05-07 — Tally → Accountancy rename + simplification cleanup (Milestone 20)

- **Module renamed** "Tally" → "Accountancy" across the codebase:
  - Route group `(protected)/office/(tally)/tally/...` → `(protected)/office/accountancy/...` (no more `(tally)` group).
  - `src/modules/tally/` → `src/modules/accountancy/`.
  - All sidebar nav, page titles, doc references updated. User-facing label is **Accountancy**; internal module name follows suit.
- **Simplification roadmap Steps 0–4** shipped (per `memory/simplification_roadmap.md`). Includes a DB reset + reseed pass. Step 5 (route restructure) deferred; Step 6 (docs) shipped via `docs/modules/*`.
- **Module docs scaffolded** under `docs/modules/<module>.md` (pos, accountancy, inventory, people, repair, sales, messaging) with a uniform template: URLs (UI + API), Permissions, Prisma models, Key components, Common workflows, Gotchas, Reusable helpers.
- **`docs/reusables.md`** introduced as the cross-cutting registry: every helper / hook / schema / formatter / shared component that lives in `src/shared/` is registered with file path + purpose. New rule (in `AGENTS.md`): adding shared surface area requires same-commit registry update.

### 2026-05-07 — Accountancy Phase 5a: Reports hub + GST hub + Party CRM (Milestones 12 + 19)

- **Tally route group renamed**: `(tally)/finance/` → `(tally)/tally/`. Module page is `/office/accountancy`. Sidebar nav flattened (single prefix per module).
- **New report pages** under `src/app/(protected)/office/(tally)/tally/reports/`:
  - `cash-book/`, `bank-book/`, `bank-reconciliation/`
  - `cash-flow/`, `fund-flow/`, `ratio-analysis/`, `statistics/`
  - `receivables/`, `payables/`, `ledger-outstandings/[ledgerId]/`
  - `gst/` (hub) + `gst/hsn-summary/`, `gst/inward-supplies/`, `gst/outward-supplies/`, `gst/liability/`
- **New API routes** under `src/app/api/finance/reports/`: `cash-flow`, `fund-flow`, `ratio-analysis`, `statistics`, `gst-summary`, `gst-hsn-summary`, `payables`, `receivables`, `ledger-outstandings/[ledgerId]`
- **Shared report components**: `src/modules/tally/components/BookPage.tsx` (reusable cash/bank book layout), `src/modules/tally/components/GstSummaryView.tsx`
- **Tally lib**: `src/modules/tally/lib/outstandings.ts` (party outstanding tracking)
- **GST schema additions**:
  - `prisma/schema/base.prisma` — added `gstin`, `gstStateCode`, `gstRegType`, `financialYearFrom`, `booksBeginningFrom` to **both** `Customer` and `Company`
  - `prisma/schema/enums.prisma` — `GstRegType` (REGULAR, COMPOSITION, SEZ, UNREGISTERED), `Taxability` (TAXABLE, EXEMPT, NIL_RATED, NON_GST)
  - `prisma/schema/inventory.prisma` — `hsnCode`, `gstRate`, `taxability` on `InvProduct`
- **`PartyCombobox`** (`src/modules/tally/components/PartyCombobox.tsx`): searchable customer/supplier picker; autofills GSTIN/state/regType on selection. Wired into `tally/sales/new`, `tally/purchases/new`, `tally/estimates/new`.
- **`InvProductCombobox`** (`src/modules/inventory/components/InvProductCombobox.tsx`): inline Tally-style product picker with stock/price/unit/brand columns; replaces modal dialog for voucher line entry.
- **Customers API**: `GET /api/customers` returns GSTIN/state/regType for party matching.
- **`createDialogStore`** (`src/store/createDialogStore.ts`): Zustand store driving the unified person/company creation modal triggered from the create-actions dialog.
- **Shared UI updates**: `AllCreateActionsDialog.tsx`, `ButtonBar.tsx`, `Sidebar.tsx` — refactored for the new flattened module nav and the unified create modal.
- **`.claude/scheduled_tasks.lock`** committed (commit 3fd8d88) — JSON `{sessionId, pid, acquiredAt}` to prevent concurrent scheduled-task execution.

### 2026-05-05 — Tally Phase 4: Account groups, ledgers, estimates, journal lifecycle, opening balances (Milestone 18)

- **Account groups + ledgers**: full CRUD for chart-of-accounts hierarchy (`AccountGroup`, `Ledger`); replaces the older flat `GlAccount` workflow. New API endpoints under `src/app/api/finance/`.
- **Estimates / quotation voucher**: new voucher type alongside sales and purchases; pages under `(tally)/tally/estimates/` (`page.tsx`, `new/`, `[id]/`).
- **Three-tier journal delete** (commit c1e4fa0) on journal entries:
  - **Void** — keeps row, marks status `VOID`, no GL impact
  - **Soft-delete** — hides from lists, retains audit trail
  - **Hard-delete** — admin-only, fully removes
- **Suspense ledger for opening balances** (commit f14acf0): when manually-entered opening balances don't tie out, the difference posts to a system "Suspense" ledger so trial balance always balances.
- **Master opening balances** (commit 81070d2): `src/modules/tally/lib/openingBalance.ts` + `aggregateLedger.ts` — books-beginning-from date drives opening balance carry-forward; year-end close logic.

### 2026-05-04 — CRM Leads + Inventory unification + Inventory vouchers (Milestones 16 + 17)

- **CRM Lead module** (commit 4226994):
  - `prisma/schema/crm.prisma` — `CrmLead` model (status pipeline, assigned-to, source, expected value, customer link)
  - Pages under `(protected)/office/(customer)/leads/` (list + detail) with kanban-style status pipeline
  - API `src/app/api/crm/leads/`
- **InvProduct unification** (commit 9066da3): `ShopProduct` model **merged into** `InvProduct`. The catalog (shop) and inventory (warehouse) now share one product model. `prisma/schema/shop.prisma` reduced to order-side models; `inventory.prisma` is the product source of truth.
- **Inventory vouchers** (commits 82fb35f, 2ab5f16, 7383be7): receipt/issue/transfer/adjustment voucher models + pages under `(tally)/tally/inventory/...`. New API under `src/app/api/inventory/`. Components: `InvVoucherForm`, `InvVoucherDetail`, `InvProductFormFields`, `InvProductPicker`.
- **Order source filter** on invoices page (commit dfecf61): filter invoices by origin channel (shop, ticket, manual).
- **Permissions + sidebar restructure** (commit 7779177): inventory + CRM permissions added; sidebar groups updated; new permission keys seeded.
- **Routing restructure + auth flows** (commit 5eedcb0): authentication redirect logic refined for staff vs portal split.
- **`/office/` prefix** finalised (commit 2217a0d): all staff routes confirmed under `/office/*`; branches/departments/roles pages live under `(admin)`.

### 2026-05-03 — Customer portal + ecommerce account management

- **Customer portal account hub**: order history, ticket list, profile page under `/portal/...`. Scrollable areas, mobile UX polish.
- **Emergency password reset** (commit b1636ca): customer-facing `POST /api/portal/password-reset` flow with token issued via email/phone; admin can also force-reset from staff side.
- **Order status transitions module** (commit 191e3ce): extracted into a dedicated module so both staff and portal use the same state machine.
- **Ecommerce account management** (commit 4f0eb55): customer can manage ecommerce identity (addresses, default payment) from the portal.

### 2026-05-02 — Ecommerce Admin + Org Chart + Sub-status Groups (Milestone 15)

- **Ecommerce admin pages**: `/office/ecommerce/products` (staff product management) + `/office/ecommerce/orders` (staff order list); live under `(protected)/office/(e-commerce)/` with dedicated layout
- **Ecommerce API**: `GET/POST /api/ecommerce/products` + `GET /api/ecommerce/orders` — staff-side reads of `ShopProduct` / `ShopOrder` records
- **Org chart**: `(admin)/org-chart/` — visual org tree page; `GET /api/org-chart` returns hierarchical user/department/branch structure
- **Sub-status groups**: `GET/POST /api/sub-status-groups`, `GET/PATCH/DELETE /api/sub-status-groups/[id]` — groups for organising sub-statuses in settings UI
- **Serial number search**: `(core)/search-slno/` page + `GET /api/search-slno` + `GET /api/search-slno/[deviceId]` — look up tickets by device serial number
- **All-customers view**: `(customer)/all/` — unified list combining customers and companies
- Files: `src/app/(protected)/office/(e-commerce)/ecommerce/`, `src/app/(protected)/office/(admin)/org-chart/`, `src/app/(protected)/office/(core)/search-slno/`, `src/app/(protected)/office/(customer)/all/`, `src/app/api/ecommerce/`, `src/app/api/org-chart/`, `src/app/api/sub-status-groups/`, `src/app/api/search-slno/`

### 2026-05-02 — Social / Staff Profiles + Call Log (Milestone 14)

- **Social wall**: `social.prisma` — `WallPost` model (`wallUserId`, `authorId`, `body`); `(social)/users/[id]/` profile page shows user info + wall posts feed; users can post to each other's walls
- **Wall API**: `GET /api/users/[id]/wall` — paginated wall posts for a user; `POST/DELETE /api/wall-posts/[postId]` — create and delete wall posts; `GET /api/posts`, `GET/PATCH/DELETE /api/posts/[id]`, `/api/posts/[id]/holders`, `/api/posts/[id]/holders/[userId]` — internal post/notice board
- **`(admin)/posts/` page**: staff notice board management with dedicated layout
- **User activity**: `GET /api/users/[id]/activity` — activity feed for a user's recent actions
- **Call log**: `(core)/call-log/` page with `CallLogFilters.tsx` client component for filter sidebar; `GET/POST /api/call-logs` + `GET/PATCH /api/call-logs/[id]` — track inbound/outbound customer calls with status, direction, duration, and follow-up amount
- **Notifications**: `GET /api/notifications` + `GET/PATCH /api/notifications/[id]` — per-user notification list with read/unread state
- **User password change**: `PATCH /api/users/[id]/password` — self-service or admin password reset endpoint
- Files: `prisma/schema/social.prisma`, `src/app/(protected)/office/(social)/users/[id]/`, `src/app/(protected)/office/(admin)/posts/`, `src/app/(protected)/office/(core)/call-log/`, `src/app/api/wall-posts/`, `src/app/api/posts/`, `src/app/api/call-logs/`, `src/app/api/notifications/`, `src/app/api/users/[id]/activity/`, `src/app/api/users/[id]/password/`, `src/app/api/users/[id]/wall/`

### 2026-05-02 — External Shop + Customer Portal (Milestone 13)

- **`(external)` app route group**: entire public/customer-facing surface outside the staff app; two sub-surfaces:
  - **`(store)` homepage**: `/` (store root) — full marketing homepage with hero carousel, deal-of-the-day, featured products row, brand strip, trust strip, category showcase, promo banners; SSR, no auth required
  - **Shop** (`/shop/*`): product listing page, product detail (`/shop/product/[handle]`), cart, wishlist, compare, checkout, order confirmation (`/shop/order/[id]`); own layout with `ShopHeader` + `ShopFooter`
  - **Portal** (`/portal/*`): customer hub (register, ticket tracking at `/portal/tickets`, etc.); customer **sign-in** is at **`/login`** (staff at **`/staff/login`**); own layout with `PortalHeader` / `PortalAppShell`
- **`external` module** (`src/modules/external/`):
  - `shop/`: `ShopHeader`, `ShopFooter`, `ShopSearchBar`, `ProductCard`, `AddToCartButton`, `ShopCatalogClient`, `ProductDetailTabs`, `ProductGallery`, `ProductPurchasePanel`, `ShopPageBanner`, `ShopRemoteImage`
  - `store/`: `HeroCarousel`, `DealOfTheDay`, `FeaturedRow`, `BrandStrip`, `TrustStrip`, `CategoryShowcase`, `PromoBanners`
  - `portal/`: `PortalHeader`
  - `ExternalRootShell.tsx`: root layout shell wrapping NextAuth `SessionProvider` for the external surface
- **New Prisma schemas**:
  - `shop.prisma` — `ShopProduct` (slug, name, pricePaise, mrpPaise, galleryJson, specsJson), `ShopOrder` (status, customerId/guestEmail, razorpayOrderId), `ShopOrderLine`; prices stored as integer paise
  - `portal.prisma` — `CustomerPortalCredential` (phoneNormalized, emailNormalized, passwordHash, linked to `Customer`)
- **Shop API**: `GET /api/shop/products`, `GET /api/shop/products/[handle]`, `GET/POST /api/shop/orders`, `POST /api/shop/orders/[id]/razorpay` (create Razorpay order), `POST /api/shop/razorpay/webhook` (payment verification)
- **Portal API**: `POST /api/portal/register`, `GET /api/portal/tickets`
- **Razorpay**: integrated for checkout; Razorpay order created server-side, payment verified via signed webhook
- **Cloudinary upload**: `POST /api/upload-signature` — generates signed upload params for direct browser-to-Cloudinary uploads (used in product image management)
- **Zustand external stores** (`src/store/external/`): `shopCartStore.ts` (cart items + quantity), `shopWishlistStore.ts` (wishlisted product IDs), `shopCompareStore.ts` (up to 3 products for side-by-side compare); all client-side, localStorage-persisted
- **Shop lib** (`src/shared/lib/shop/`): `storeContent.ts` (homepage content config — hero slides, featured rows, brand list, trust points), `productPublic.ts` (public product queries), `demoReviews.ts` (static review data for UI), `shopImagePlaceholder.ts` (fallback image helper). Demo product catalog seed lives at `prisma/seeds/data/demoCatalogSeed.ts` (consumed by `prisma/seeds/dummy-shop.ts`).
- **Portal auth lib** (`src/shared/lib/auth/`): `authorizePortal.ts` (portal credential check + bcrypt), `portalIdentifier.ts` (phone/email normalisation), `staffEmailAllowlist.ts`, `authorizeStaff.ts`, `portalAuthGuard.ts` (portal-side `requirePortalAuth` guard), `makePermissionLayout.tsx` (factory for permission-gated layout wrappers), `permissionScope.ts`. Ticket scoping: `src/shared/lib/format/ticketScope.ts` (moves to `src/modules/repairing/lib/` in Segment 08).
- Files: `src/app/(external)/`, `src/modules/external/`, `prisma/schema/shop.prisma`, `prisma/schema/portal.prisma`, `src/store/external/`, `src/shared/lib/shop/`, `src/shared/lib/auth/`, `src/shared/lib/portal/`, `src/app/api/shop/`, `src/app/api/portal/`, `src/app/api/upload-signature/`

### 2026-04-29 — Enterprise RBAC — Rank, Scope, Department, Branch

- **Role rank**: `rank Int` added to `Role` model (0–100); Admin=100, Manager=70, Staff=20; rank guard on `POST/PUT /api/users` prevents assigning a role equal to or above your own rank
- **UserScope enum**: `OWN | TEAM | DEPARTMENT | BRANCH | REGION | ORG` — controls how far a user's data visibility reaches
- **Branch model**: `prisma/schema/org.prisma` — id, name, address, phone, isActive; seeded with 4 sample branches (HQ, Mirpur, Chittagong, Online)
- **Department model**: `prisma/schema/org.prisma` — id, name, description, branchId (null = cross-branch); seeded with 7 departments (Repairs, Sales, Front Desk, Finance, HR, IT/Admin, Despatch)
- **User model**: added `title String?`, `scope UserScope @default(OWN)`, `departmentId`, `branchId`
- **Auth/JWT**: `rank`, `scope`, `departmentId`, `branchId`, `title` now carried in JWT and session
- **API**: `/api/branches` + `/api/departments` (full CRUD); `/api/roles` accepts `rank`; `/api/users` includes dept/branch/scope/title in responses
- **Settings UI**: `/office/admin/branches` page (CRUD + activate/deactivate toggle); `/office/admin/departments` page (CRUD with branch scope selector)
- **Roles settings**: rank displayed per role with inline click-to-edit; rank field in new role form
- **UserForm**: expanded with Title, Department, Branch, Scope, and role rank shown in dropdown
- **Users list**: added Department, Branch, Scope, Title columns; role shows rank badge
- **Sidebar**: Branches + Departments added under Settings nav (require `settings:manage` permission)
- **Seed**: `prisma/seed-org.ts` + SQL seed via `prisma db execute`
- Files: `prisma/schema/org.prisma`, `prisma/schema/enums.prisma`, `prisma/schema/rbac.prisma`, `prisma/schema/users.prisma`, `src/auth.ts`, `src/auth.d.ts`, `src/shared/lib/auth/permissions.ts`, `src/app/api/branches/`, `src/app/api/departments/`, `src/app/api/roles/`, `src/app/api/users/`, `src/app/(protected)/office/(admin)/branches/page.tsx`, `src/app/(protected)/office/(admin)/departments/page.tsx`, `src/shared/components/UserForm.tsx`, `src/app/(protected)/office/(admin)/users/page.tsx`, `src/utils/constants.ts`

### 2026-04-28 — Message creation optimisation + Sentry setup
- **Messaging**: Replaced `createRoomMessage` helper with direct `prisma.chatMessage.create`; concurrent `updatedAt` write to `ChatRoom` in same operation for consistency; removed redundant `ensureCoreRooms` call on `getAccessibleRoom`
- **Sentry**: `@sentry/nextjs` version pinned to `10`; `next.config.ts` updated with org/project details, Vercel Cron Monitor auto-instrumentation, improved source-map handling; `sentry.server.config.ts` + `sentry.edge.config.ts` created; `.env.sentry-build-plugin` added to `.gitignore`
- Files: `src/app/api/inbox/rooms/[id]/messages/route.ts`, `src/shared/lib/prisma/prismaClient.ts`, `src/modules/message/lib/inbox.ts`, `next.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`

### 2026-04-27 — Domain module restructure + route groups
- **`src/modules/`** introduced: `core`, `customer`, `message`, `repairing`, `tally`, `shared` — domain-specific components and lib files moved into respective modules
- **Route groups** under `(protected)/office/`: `(admin)`, `(core)`, `(customer)`, `(message)`, `(repairing)`, `(tally)`, `(e-commerce)`, `(social)` — staff URLs are prefixed with `/office` (e.g. `/office/tickets`)
- `assignments/` moved from `(repairing)` → `(core)` (cross-module work queue, not repairing-specific)
- **Constants centralised** into `src/utils/constants.ts`: `COLOR_OPTIONS`, `fmt()`, `INVOICE_STATUS_COLORS`, `JOURNAL_STATUS_COLORS`, `GL_TYPE_COLORS`, `GL_TYPE_ORDER`, `GlAccountType`, `WARRANTY_SCOPE_OPTIONS` — all local duplicates removed
- **Role labels**: Removed hardcoded `ROLE_LABELS`; new `GET /api/roles/labels` endpoint; `StatusUpdateCombined` + `SubStatusUpdate` fetch labels dynamically via `roleLabelMap`
- Files: `src/modules/*/`, `src/app/(protected)/office/*/`, `src/utils/constants.ts`, `src/app/api/roles/labels/route.ts`

### 2026-04-27 — Neo Brutalism UI theme
- All `rounded-*` classes removed from every UI element (flat, sharp corners throughout)
- Raw colour values (`bg-white`, `bg-gray-*`, `text-gray-*`) replaced with Tailwind theme vars (`bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`)
- All containers and inputs use `border-2 border-border`
- Raw modals converted to shadcn `Dialog` on accounts + finance detail pages
- shadcn primitives (`dialog`, `select`, `tabs`, `textarea`, `dropdown-menu`) patched to remove border-radius
- Tickets list + detail pages fully rewritten for the new theme
- Files: virtually all page and component files, `src/components/ui/*`

### 2026-04-27 — Supabase Realtime + Slack layout + build fix
- **Supabase Realtime**: `@supabase/supabase-js` installed via pnpm; `src/shared/lib/supabase/supabaseClient.ts` singleton; `InboxModule` subscribes to `ChatMessage INSERT` per active room — messages appear instantly across all users with no polling
- **Optimistic send**: message appears immediately with "sending…" label; Realtime replaces it with the confirmed DB record on success, rolls back on failure
- **Slack-style layout**: full-width messages, avatar + bold name + timestamp per group, consecutive messages from same sender grouped, own messages have `bg-primary/5` row tint
- **Notifications**: Web Notifications API (browser permission requested on mount) + Web Audio API "ding" sound for incoming messages from other users
- **Avatar colour fix**: own avatar = `bg-primary/20 text-primary`; others = `bg-muted text-foreground` — no more red circles for other users
- **Timestamp fix**: Supabase Realtime omits UTC 'Z' suffix — normalised before `new Date()` parse
- **Personal Inbox removed**: `PERSONAL_INBOX` rooms no longer created; filtered from all queries
- **Build fix**: `QuickTicketButton.tsx` line 669 — `technician.id` wrapped in `String()` for `SelectItem.value`
- Files: `src/modules/message/components/InboxModule.tsx`, `src/shared/lib/supabase/supabaseClient.ts`, `src/modules/message/lib/inbox.ts`, `src/app/(protected)/office/(message)/inbox/page.tsx`, `src/shared/components/QuickTicketButton.tsx`, `.env`

### 2026-04-26 — Inbox UI overhaul + expandable sidebar nav
- **InboxModule rewrite**: rooms now grouped by type (System / Personal / Groups / Others) with collapsible sections; proper chat bubble layout (own messages right, others left, system centered); auto-scroll to bottom; Enter to send / Shift+Enter for newline; relative timestamps ("2m ago")
- **Sidebar Inbox section**: Inbox moved from flat WORKSPACE_NAV link to an expandable accordion — shows System / Personal / Groups sub-sections each with live unread counts fetched from `/api/inbox/rooms`; total unread badge on the Inbox header
- **Inbox page**: now passes `currentUserId` (from session) to InboxModule so own messages are aligned right; wrapped in Suspense for `useSearchParams` compatibility
- Files: `src/modules/message/components/InboxModule.tsx`, `src/shared/components/Sidebar.tsx`, `src/utils/constants.ts`, `src/app/(protected)/office/(message)/inbox/page.tsx`

### 2026-04-24 — Customer + Company model split (Milestone 11 finale)
- **Separated Account → Customer + Company**: `Customer` model (individuals) + `Company` model (businesses) + `CustomerCompany` join table for many-to-many links; `Account` model retained as legacy bridge
- **New pages**: `/office/customers/[id]` full detail + `/office/companies` list + `/office/companies/[id]` detail
- **New API routes**: `GET/PATCH/DELETE /api/customers/[id]`, `GET/POST /api/companies`, `GET/PATCH/DELETE /api/companies/[id]`, `POST /api/companies/[id]/links`
- **New components**: `CompanyLinkPanel.tsx`, `CustomerLinkPanel.tsx` — manage many-to-many links inline
- **QuickTicketButton** refactored to support `initialPipelineId` and pipeline-aware creation flow
- Files: `prisma/schema.prisma`, `src/app/(protected)/office/(customer)/customers/`, `src/app/(protected)/office/(customer)/companies/`, `src/app/api/customers/`, `src/app/api/companies/`, `src/modules/customer/`

### 2026-04-24 — Account model + PipelineTransferModal
- Introduced `Account` model (type: individual/company, address, taxId) as step toward CRM; `AccountForm.tsx` reusable form
- `POST /api/tickets/[id]/transfer` — moves a ticket between pipelines; `PipelineTransferModal.tsx` UI
- `seed-business-pipelines.ts` — seeds Repair + Sales pipelines
- `/api/accounts` + `/api/accounts/[id]` + `/api/accounts/[id]/relationships` endpoints

### 2026-04-24 — Navigation overhaul: /assignments as default
- Default post-login redirect: `/office/core/assignments` (staff app; was `/assignments` then `/dashboard` historically)
- Dashboard now accepts pipeline context; tickets page filtered by pipeline
- `proxy.ts` updated with redirect target
- Files: `src/app/(protected)/office/(repairing)/dashboard/page.tsx`, `src/app/(protected)/office/(repairing)/tickets/page.tsx`, `src/proxy.ts`, `src/shared/components/Sidebar.tsx`

### 2026-04-24 — UniversalCreateMenu + layout
- `UniversalCreateMenu.tsx` — floating "+" menu in `ProtectedLayout` for quick access to create actions
- Sidebar dynamically fetches and displays active pipelines (server-side); pipeline switching navigation
- Files: `src/shared/components/UniversalCreateMenu.tsx`, `src/app/(protected)/layout.tsx`, `src/shared/components/Sidebar.tsx`

### 2026-04-24 — Pipeline System (Milestone 11 core)
- `Pipeline` model: `id`, `name`, `label`, `description`, `color`, `isDefault`, `isActive`, `order`
- `TicketStatus`, `TicketSubStatus`, `Ticket` all have `pipelineId` — statuses/sub-statuses can be scoped to a pipeline
- `isEntryPoint Boolean @default(false)` added to `TicketStatus`
- `isEntryPoint` checkbox added to sub-status form in settings UI
- New settings page `/office/settings/pipelines` (full CRUD)
- `seed-pipelines.ts`
- Files: `prisma/schema.prisma`, `src/app/(protected)/office/(repairing)/settings/pipelines/page.tsx`, `src/app/(protected)/office/(repairing)/settings/statuses/page.tsx`, `src/app/(protected)/office/(repairing)/settings/sub-statuses/page.tsx`

### 2026-04-23 — Auth type cleanup + role selection fixes
- `auth.d.ts` import changed to type-only; role selection logic in `RolesSettingsPage` and `UserForm` refactored
- `UserForm` enforces at least one role selected; uses role IDs from DB properly
- Files: `src/auth.d.ts`, `src/shared/components/UserForm.tsx`, `src/app/(protected)/office/(admin)/roles/page.tsx`

### 2026-04-23 — Zod validation across all API endpoints (Milestone 10)
- Zod schemas added to: roles, sub-statuses, ticket-statuses, users, tasks (assign, notes, participants, sub-status, warranty, permissions)
- All endpoints return structured validation error messages on bad input
- Files: `src/app/api/roles/`, `src/app/api/sub-statuses/`, `src/app/api/ticket-statuses/`, `src/app/api/tickets/[id]/`, `src/app/api/users/`

### 2026-04-21 — Permission-based auth system (Milestone 10)
- All `requireRole("R1")` calls replaced with `requirePermission(...)` — permission-driven, not role-driven
- Layout guards check specific permissions; sidebar navigation uses permissions; dashboard routing uses permissions
- User creation assigns default role from DB (not hardcoded "R2")
- `ProtectedLayout` passes structured `{ id, roles, permissions }` user object downstream
- Warranty notifications updated to include all front-desk users regardless of role assignment method
- Files: `src/app/(protected)/layout.tsx`, `src/shared/components/Sidebar.tsx`, `src/app/(protected)/office/(core)/assignments/page.tsx`, `src/app/(protected)/office/(repairing)/dashboard/page.tsx`, multiple API routes

### 2026-04-21 — Tasks feature removed
- Entire Tasks system deleted (was Milestone 6; historical paths): `src/app/(protected)/tasks/`, `src/app/api/tasks/`, `src/components/tasks/` — removed before `/office` migration
- Dashboard simplified (no task counts)
- Sidebar "Tasks" nav item removed
- Decision: tasks were personal notepad; Assignment system + TicketParticipant handles workflow handoffs

### 2026-04-21 — Milestone 9 — Assignment & Ownership System
- `primaryOwnerId` on Ticket (renamed from `technicianId`); `TicketParticipant` model with `addedBySubStatusId` + `removedAt` (soft-delete)
- `POST /api/tickets/[id]/assign` — claim / pass / reject; optimistic lock on claim (Prisma `update where { primaryOwnerId: null }`)
- `GET/POST /api/tickets/[id]/participants` — list active secondaries; add secondary
- `DELETE /api/tickets/[id]/participants/[userId]` — soft-delete (self-removal bypasses permission check)
- Sub-status route updated: handoff logic (auto-assign if 1 candidate, returns `requiresAssignment` if multiple); auto-revert soft-deletes participants added by outgoing sub-status; all auto-task creation removed; `$transaction` wrapping; notifyRoles fixed to use `userRoles` relation
- `TicketOwnershipPanel.tsx` — primary owner + inline reassign + secondaries list + "Add Secondary"
- `HandoffPickerModal.tsx` — radio list of candidates on `requiresAssignment: true` response
- `PassRejectModal.tsx` — pass shows user picker; reject with confirmation
- `TicketCard.tsx` — conditional Claim / Pass / Reject buttons; `router.refresh()` after action
- Assignments page scopes: me = primary OR active secondary; team = direct reports via `managerId`; org = admin only
- Files: `prisma/schema.prisma`, `src/app/api/tickets/[id]/assign/`, `src/app/api/tickets/[id]/participants/`, `src/modules/repairing/components/TicketOwnershipPanel.tsx`, `src/modules/repairing/components/assignments/`, `src/app/(protected)/office/(core)/assignments/page.tsx`

### 2026-04-19 — Phase 4 complete + UX sprint + Bug fixes
- Fixed "Failed to update status" bug; escalation improvements (config-driven visibility, auto-creates Despatch task on fresh escalation, inline "Add External Ref # / RMA")
- Sidebar collapsible Settings section; sidebar width reduced to `w-56`
- Phase 4 task delegation: pickup/help endpoints; `TaskList` with picked-up banner
- Users permissions modal: ShieldCheck button per row; role-granted read-only badges; admin grant/deny overrides

### 2026-04-19 — Phases 1–3 (Multi-role, Warranty, Task System)
- See original entries above (Phase 1: UserRole/Permission models; Phase 2: Warranty system; Phase 3: Task system — later removed)

### 2026-04-18 — Role dashboards, sub-status system, auth, UX
- Front Desk / Technician / Despatch dashboards; `allowedRoles`/`notifyRoles`/`actionLabel` on statuses and sub-statuses; `triggerMap Json`; `requireRole()` guards

### 2026-04-17 — Core ticket flow
- 9 main statuses; full ticket CRUD; customer+device management; technician assignment; service centres; priorities; ticket logs; print receipt; escalation; notification bell

---

## 🔄 In Progress

_(Nothing actively in progress — POS sale return flow shipped 2026-05-14 with full three-tier lookup, sidebar nav, and lint/build green.)_

---

## 📋 Next Up (Prioritized)

### POS — natural follow-ups to the sale-return ship
1. **Return receipt print page** — `/receipt/return/[id]` mirror of the sale-receipt print page so customers walk out with a paper credit note.
2. **Multi-partial-return guard** — backend currently caps per-line at original qty but does NOT subtract qty already returned in prior return invoices. Add an aggregate check to `POST /api/pos/return`.
3. **Exchange as one atomic transaction** — currently a two-step flow (credit note → new sale draws down advance). Wrap into a single `/api/pos/exchange` if cashiers report friction.
4. **Stuck-shift auto-close cron** — abandoned OPEN shift after N hours → force close via system user with a "stuck shift" variance note.

### Accountancy Phase 5b — still deferred (most likely to get picked up next big push)
5. **GSTR-1 / GSTR-3B export** — JSON download in GSTN portal format from the GST hub.
6. **e-Invoice (IRN) integration** — IRP API on sales voucher above threshold.
7. **RCM (Reverse Charge Mechanism)** handling on purchase vouchers.

### Repair / Ops
8. **Repair-side reporting dashboard** — tickets by status/pipeline, avg resolution time, technician workload. Finance side is covered; repair side still bare.
9. **Ticket list pagination** — cursor-based or offset; current list loads all records.

### Org RBAC
10. **Branch-scoped data filtering** — tickets, customers, invoices filtered by user's `branchId` when `scope` is BRANCH or below.
11. **`settings:manage` permission** — confirm Admin role has it seeded so Branches/Departments + POS Counters pages are accessible.
12. **Position model** — named slots in the org chart (future; needed at 50+ users).

### Shop / Portal
13. **Portal ticket detail** — customers see full ticket notes and status history, not just the list.
14. **Razorpay payment status page** — post-payment redirect with real-time status polling.
15. **Stock decrement on shop order confirm** — now possible since `InvProduct` is unified and multi-branch stock is live.

### Quick UX wins
16. **U2 — duplicate Name column** in ticket list.
17. **U4 — mobile grid** layout fixes.
18. **U11 — toast label** improvements.
19. **U16 — default date sort** on ticket list (newest first).
20. **Lint warning sweep** — 36 non-blocking warnings remain (unused vars, stale `eslint-disable` directives). Mostly cosmetic; clean up next time we sweep a module.

### Longer term
21. **SLA alerts** — flag tickets in same status too long (e.g. "Diagnosing 5+ days").
22. **Company portal** — B2B version of customer portal; companies see all linked devices/tickets.
23. **ERP Module Foundation** — `AppSetting` model, static module registry, module toggle settings page (archived Phase 5).

---

## 💡 Ideas & Notes

- 2026-04-24 **Pipeline-specific dashboards**: Each pipeline (Repair, Sales) could have its own dashboard view with tailored KPIs rather than a single shared dashboard
- 2026-04-24 **Company portal**: B2B version of customer portal — companies see all devices/tickets linked to them
- 2026-04-19 **Despatch courier integration**: Auto-generate tracking label from SS22 "Pending Despatch"
- 2026-04-18 **SLA alerts**: Flag tickets in the same status for too long (e.g. "Diagnosing 5+ days")
- 2026-04-19 **Phase 5 — ERP Module Foundation (archived)**: `AppSetting` model, static module registry `src/config/modules.ts`, module toggle settings page, module-driven sidebar. Implement when ready to add CRM / Inventory / HR / Finance modules.
- 2026-04-19 **Branch + Department structure**: `Branch` (physical site) + `Department` (functional group). Users and tickets get `branchId`. `data:all_branches` permission for managers.
- 2026-04-30 **Tally mapping note**: keep accounting UX familiar to Tally users, but persist data in normalized hierarchy (`AccountType -> AccountGroup -> Account`) instead of hardcoding platform-specific group names into business logic.
- 2026-05-02 **Shop guest vs. logged-in**: `ShopOrder.customerId` is nullable — guest orders use `guestEmail`/`guestPhone`. Future: merge guest orders on portal login.
- 2026-05-02 **Prices in paise**: all shop prices stored as integer paise (₹1 = 100 paise); `money-inr.ts` handles formatting. Never store floats for currency.
- 2026-05-02 **External app split**: `docs/customer-site-shared-imports.md` tracks every import that crosses the `(external)/` boundary, to make future extraction into a separate Next.js app traceable.
- 2026-05-04 **InvProduct unification gain**: now that catalog and warehouse share one product model, shop checkout can reserve stock, and inventory adjustments propagate to the storefront with no sync layer.
- 2026-05-05 **Suspense ledger**: trial balance always balances by routing entry mismatches into a system "Suspense" ledger — easier to import legacy books from Tally without manually reconciling cents.
- 2026-05-07 **Party autofill from GSTIN**: `PartyCombobox` could call a GST lookup API to prefill name/state/regType when the user types a 15-char GSTIN.
- 2026-05-07 **Tally route rename**: `(tally)/finance/` → `(tally)/tally/` was deliberate to match the user-facing module label; any remaining `office/finance/...` links are now broken and should be migrated. Subsequently renamed again on 2026-05-07 → `accountancy/` (Milestone 20).
- 2026-05-13 **Inventory naming-convention token engine**: the token chain pattern (walk fallback fields, then default value, then skip) could extend to other auto-generated strings (SKUs, voucher references) — but probably not worth the abstraction until a second consumer exists.
- 2026-05-13 **Per-branch reorder points**: `InvProductBranch` could carry `minStock` / `maxStock` thresholds so each branch gets its own reorder trigger. Right now the global `InvProduct` thresholds apply uniformly.
- 2026-05-14 **Personal till accountability**: counter-based tills make variance accountability operational (who was on the shift) not GL-level (no personal user till accounts). If we ever want personal till accounts again, the variance JE would need a `userId` dimension or a separate audit table.
- 2026-05-14 **Multi-counter parallel billing**: same user on two browsers / two counters is supported by reading `branchId` from the shift, not from the active-branch cookie. This unlocks pop-up POS windows (`/vouchers/pos` standalone) running side by side.
- 2026-05-14 **POS return as exchange**: cashier creates credit note, customer immediately spends it on a new sale — credit sits as advance on the customer's AR until the new sale draws it down. No new API needed; a wrapper UI could automate the two-step flow.
- 2026-05-14 **Manager bypass surfaces**: pattern of "cashier perm gates the normal flow + manager perm gates the no-original / no-source variant" (Tab 3 in `PosReturnDialog`) is reusable — e.g. manager-override price discount, override stock for "found in shelf" adjustments.

---

## ⚠️ Known Issues & Gotchas

- **Server restart required after `prisma generate`**: Turbopack caches Prisma client chunks. After any schema change → `prisma db push` → `prisma generate` → **restart dev server**.
- **Next.js 16 breaking changes**: Middleware file is `src/proxy.ts` NOT `middleware.ts`.
- **Prisma adapter-pg**: Uses `@prisma/adapter-pg`. Datasource configured via `prisma.config.ts`.
- **Prisma schema layout**: This repo uses split Prisma schema files in `prisma/schema/` (configured in `prisma.config.ts`), not a single `prisma/schema.prisma`.
- **NextAuth v5 beta**: Cast `session.user` to access `id`/`role`/`roles`/`permissions`. Never use `getToken()`.
- **Scalar list filtering**: `String[]` fields use `{ has: "R3" }` in Prisma (PostgreSQL only).
- **Sub-status `allowedRoles`**: R1 always bypasses — by design.
- **Opaque IDs**: Status IDs S1–S10, sub-statuses SS1–SS37, roles R1–R4, priorities P1–P4, pipelines P-REPAIR/P-SALES.
- **`@@unique` with nullable fields**: PostgreSQL treats NULL as distinct; `skipDuplicates` may not work reliably. Use `findFirst` + `create` pattern.
- **Account model**: Still present in schema alongside `Customer` and `Company` — acts as a legacy bridge. The `Customer` and `Company` models are the source of truth going forward. `Account` may be cleaned up later.
- **Tasks feature removed**: task application code is removed. Some historical migrations may still mention task tables from older iterations.
- **`settings:manage` permission**: Branches + Departments pages require this permission. If the Admin role doesn't have it yet, go to Settings → Roles → Admin → Permissions and add `settings:manage`.
- **Sentry example files**: `src/app/api/sentry-example-api/route.ts` and `src/app/sentry-example-page/page.tsx` were added by Sentry setup — remove before production deploy if not needed.
- **Module migration incomplete**: Some components may still live in `src/components/` rather than their domain module. Gradual migration is fine; no functional impact.
- **Razorpay webhook secret**: `RAZORPAY_WEBHOOK_SECRET` must be set in `.env`; webhook handler will reject all events if missing. Verify in Razorpay dashboard → Webhooks.
- **Portal auth is separate from staff auth**: `CustomerPortalCredential` is a separate credential table; portal users cannot access staff routes and vice versa. Do not reuse staff session cookies for portal.
- **Shop prices in paise**: `ShopProduct.pricePaise` and `ShopOrder.totalPaise` are integers representing paise. Always use `money-inr.ts` helpers to format for display; never divide by 100 inline.
- **External stores are client-only**: `shopCartStore`, `shopWishlistStore`, `shopCompareStore` use Zustand with localStorage persistence. They are not synced to the DB — cart is lost on a different browser/device until checkout creates a `ShopOrder`.
- **`(store)` sub-group**: The store homepage lives under `src/app/(external)/(store)/` as its own route sub-group so it gets a different layout from the shop pages.
- **Tally route rename**: any link to `/office/finance/...` is broken — current root is `/office/accountancy/...`. Sidebar already updated; check older bookmarks/screenshots before reusing.
- **`.claude/scheduled_tasks.lock` is committed** (commit 3fd8d88). Tracks active scheduled-task session (`{sessionId, pid, acquiredAt}`). A previous merge already removed a similar artifact (commit 19ed1de). If this becomes a coordination headache, move it to `.gitignore` — confirm with the user first.
- **GST fields are nullable**: `gstin`, `gstStateCode`, `gstRegType` etc. are optional on `Customer`/`Company` — non-GST consumers don't need them. Treat empty as "unregistered/consumer" in voucher logic.
- **Composition party = no GST charge**: when `Customer.gstRegType === 'COMPOSITION'`, sales vouchers should not add GST lines even if the product has `hsnCode` and `gstRate`. Voucher logic must check both sides.
- **InvProduct is now the single product source of truth** (post 2026-05-04). Shop product pages and inventory vouchers read from the same model; there is no `ShopProduct` table anymore. Migrations from older shop seed scripts will fail.
- **CrmLead vs Customer**: a `CrmLead` is a prospect (no purchase yet); converting a lead promotes it to `Customer`. Don't dual-write — the lead-to-customer transition is the conversion event.
- **Tally → Accountancy rename (2026-05-07)**: the route group `(tally)/tally/` was renamed to plain `accountancy/`. Any link to `/office/finance/...` or `/office/tally/...` is broken — current root is `/office/accountancy/...`. Module folder is `src/modules/accountancy/`.
- **POS register lives at `/vouchers/pos`**, NOT `/office/pos`. The page is a standalone full-screen shell (its own layout with `fixed inset-0`, no office sidebar). The office has `/office/pos/shifts` (shift reports) but **no** `/office/pos` page — going there returns 404. Sidebar nav handles this with `newTab: true` for "POS Register" (`/vouchers/pos`) and same-window navigation for "Shift Reports" (`/office/pos/shifts`).
- **`/vouchers/pos` layout needs `<SessionWrapper>`** so client components inside (`PosReturnDialog`, anything using `useSession`) get the `SessionProvider`. The office layout already does this; the standalone POS layout had to be patched. If we add another standalone `/vouchers/*` route group with client components that read the session, remember to wrap.
- **`(gl)` route group makes its pages dynamic** because the layout does `await auth()`. The 6 non-`(gl)` voucher `/new` pages (challans, grn, purchase-orders, rejections-in, rejections-out, sales-orders) do NOT inherit this, so they each ship `export const dynamic = "force-dynamic"` to skip prerender. If you add a new non-`(gl)` voucher new-page that uses `SaleVoucherPage`, copy that export or you'll hit "useSearchParams() should be wrapped in a Suspense boundary" at build time.
- **`react-hooks/set-state-in-effect` lint placement**: the `// eslint-disable-next-line` comment must sit **directly above the specific `setState` call inside the effect body**, not above the `useEffect(` line. The disable only suppresses the next physical line. The same applies to setLoading / loader function calls inside effects.
- **`react-hooks/refs` JSX-comment disable doesn't reach attribute-level violations**: `{/* eslint-disable-next-line react-hooks/refs */}` applies to the next JSX element/sibling, not to attribute-level rule reports. For ref-forwarding patterns (passing `cb.wrapperRef` etc.), use file-level `/* eslint-disable react-hooks/refs */` with an explanatory header.
- **POS counter till is shared, not personal**: variance JE always hits the **counter** till GL account, never a user account. Personal tills were dropped 2026-05-14. Human accountability comes from the shift report (who was on shift when), not the GL ledger.
- **AWAITING_HANDOVER blocks billing**: POS sale endpoint requires `shift.status === "OPEN"`. Cashier in AWAITING_HANDOVER cannot bill — they're between handover initiation and B's acceptance.
- **POS sale return GL is protected** (`docs/completed-and-protected.md` 2026-05-14): three-tier lookup, CASH/CREDIT JE paths, `SALE_RETURN InvVoucher`, and `Invoice.returnOfId` back-link are guarded. Refactor / restyle freely; behaviour changes need explicit approval.
- **Return walk-in block**: `customerAccountId` is required on `POST /api/pos/return/lost`. The dialog enforces it client-side by hiding Tab 3 unless a customer is picked first. Walk-in customers (no debtor record) cannot use the no-original-invoice return flow.

---

## 🧠 Key Decisions Log

| Decision | Chosen | Alternatives Considered | Reason |
|----------|--------|------------------------|--------|
| Auth | NextAuth v5 JWT | Clerk, custom JWT | Free, open source, fits stack |
| Status IDs | Opaque strings (S1-S9) | Enums, UUIDs | Readable, stable |
| Sub-status trigger | `triggerMap Json` | Separate trigger table | Simpler; JSON stores per-parent target |
| Multi-role users | `UserRole` join table | Changing `User.role` to array | Additive; legacy `User.role` kept for compat |
| Warranty scope | Plain string on both Status and SubStatus | Enum / status-only | Zero migration impact; defaults to "any" |
| Warranty conversion | Dedicated `/warranty` endpoint + bridge SS | Sub-status transition | Conversion changes data model, not just workflow |
| Task deduplication | `findFirst` + `create` wrapped in try-catch | `createMany skipDuplicates` | More reliable with nullable unique constraint fields |
| Escalation visibility | `fromTransitions.some(t => t.to.id === "S4")` | Hardcoded status IDs | Config-driven; status graph controls when escalation is available |
| Settings nav | Collapsible sidebar section | Separate settings layout | Saves vertical space; groups related admin items |
| Phase 5 (ERP modules) | Archived for later | Immediate implementation | Core workflows must be stable first |
| Ticket ownership | `primaryOwnerId` + `TicketParticipant` table | Single field / array field | Primary = accountable; secondaries = named helpers at stages; history preserved |
| Sub-status handoff | `handoffRole` on sub-status; auto-assign if 1, picker if multiple | Always manual / always auto | Removes friction for small teams; scales to larger ones |
| Handoff revert | `autoRevertOnClear` flag + `addedBySubStatusId` | Manual removal only | Sub-status-added participants auto-deleted when sub-status changes |
| Assignment page scopes | me = primary OR secondary; team = direct reports via `managerId`; org = admin only | Role-based notifyRoles filter | Ownership-based is accurate |
| Secondary sub-status rights | Secondaries CAN update sub-status | Primary-only updates | Secondaries are actively working the ticket; blocking creates friction |
| Tasks feature | Removed entirely | Keep as personal notepad | Assignment + TicketParticipant handles all workflow handoffs; tasks added unused complexity |
| Permission-based guards | `requirePermission(...)` everywhere | `requireRole("R1")` | Role-agnostic; admins can grant any permission to any role |
| API validation | Zod schemas on all write endpoints | Manual checks / no validation | Consistent error messages; type-safe parsed input |
| Pipeline system | `Pipeline` model scoping statuses/sub-statuses/tickets | Single flat workflow | Repair shop may have Repair + Sales + B2B pipelines with different workflows |
| Customer/Company split | Separate `Customer` + `Company` + `CustomerCompany` join | Single `Account` with type flag | Cleaner relations; companies have their own full pages + many-to-many with customers |
| Default post-login redirect | `/office/core/assignments` | `/dashboard` (historical) | Staff app lives under `/office/*`; assignments remain the primary work surface |
| Concurrent claim | `update where { primaryOwnerId: null }` optimistic lock | Application-level check | Database atomicity; throws RecordNotFound on race condition |
| Codebase structure | `src/modules/<domain>/` + `src/app/(protected)/office/` route groups | Flat `src/components/` + `src/app/(protected)/` | Domain modules + `/office`-prefixed staff URLs; public shop/portal stay at `/`, `/shop`, `/portal` |
| UI theme | Neo Brutalism (sharp corners, `border-2`, theme vars only) | Default shadcn rounded style | Design decision for shop context; enforced by removing all `rounded-*` classes |
| Role labels | Dynamic fetch from `/api/roles/labels` | Hardcoded `ROLE_LABELS` constant | Roles are DB-driven; hardcoding would break when roles are renamed in settings |
| Rank on Role not User | `Role.rank` (not per-user) | Per-user rank field | Role defines authority ceiling; individuals inherit via their role assignment |
| Scope on User not Role | `User.scope` (per-user) | Scope on Role | Two people with same role can have different data reach (e.g. local vs regional mgr) |
| Department cross-branch by default | `Department.branchId` nullable | Dept always branch-scoped | Most departments (HR, IT, Finance) span all branches; branch-specific is the exception |
| Branch-scoped data filtering deferred | Schema only; no query filters yet | Implement immediately | Core workflows must be stable; branch scoping changes every data query — separate milestone |
| Shop prices in paise | `pricePaise Int` / `totalPaise Int` | Decimal/float | Avoids floating-point rounding errors; consistent with Indian payment APIs (Razorpay uses paise) |
| Portal auth separate from staff auth | `CustomerPortalCredential` table + `portal-auth-guard.ts` | Shared NextAuth session | Staff and customer sessions must never be confused; separate credential table + guard keeps boundaries clear |
| External stores client-only | Zustand + localStorage (no DB sync until checkout) | Server-side cart | Reduces latency; guest users don't need accounts to browse; DB record (`ShopOrder`) created only at checkout |
| Razorpay webhook verification | HMAC-SHA256 signature check in `/api/shop/razorpay/webhook` | Trust payment response | Webhooks are the authoritative payment confirmation; payment response from client is not trusted |
| `(external)` as separate route group | `src/app/(external)/` with own layout tree | Same layout as staff app | Customer/shop surface needs completely different headers, auth, and styling from staff app |
| Store homepage in `(store)` sub-group | `(external)/(store)/` sub-group with own layout | Flat under `(external)/` | Allows different layout (no ShopHeader/Footer) for the marketing homepage vs. the shop pages |
| Social wall on staff profiles | `WallPost` model; any staff member can post on any other's wall | Post only on own wall | Encourages team communication; wall is visible to all staff |
| Call log as CRM primitive | `CallLog` records linked to customer optionally | Notes-only approach | Makes calls searchable, filterable, and reportable; foundation for future auto-dialer or CRM pipeline |
| GST fields on Customer + Company (not new Party model) | Both models carry GSTIN/state/regType/financialYearFrom/booksBeginningFrom | Single unified `Party` model | Existing Customer/Company split is load-bearing across CRM, tickets, vouchers — duplicating five fields was cheaper than a model migration |
| Tally route group rename | `(tally)/finance/` → `(tally)/tally/` | Keep `finance` | "Tally" is the user-facing label that accountants recognise; matching the URL avoids the mental hop |
| Party picker autofills GST | `PartyCombobox` returns full party with GST fields | Voucher manually re-fetches | One round trip; party data is small; reduces flicker on voucher entry |
| Inv product picker style | Inline dropdown (`InvProductCombobox`) | Modal dialog | Tally-style fast keyboard entry; modals break the rhythm of voucher line entry |
| HSN + gstRate on `InvProduct` | Stored per product | Per voucher line | HSN is a property of the product, not the transaction; one place to update when GST rates change |
| ShopProduct merged into InvProduct | One product model serves both shop + warehouse | Keep separate, sync via worker | No sync layer to write or maintain; stock decrement on order confirm is direct |
| Three-tier journal delete | Void / soft-delete / hard-delete | Single hard-delete | Accountants need to neutralise an entry without losing audit trail; void keeps the row visible in audit; hard-delete is admin-only emergency tool |
| Suspense ledger for opening balance mismatch | System "Suspense" ledger absorbs mismatch | Block save until balanced | Tally users routinely import imbalanced legacy books; Suspense lets them save and reconcile incrementally |
| Master opening balances | Books-beginning-from date drives carry-forward | Period-by-period manual entry | Single source of truth; year-end close auto-rolls; matches Tally mental model |
| CrmLead is a prospect (separate from Customer) | `CrmLead` table; conversion promotes to Customer | Reuse Customer with status flag | Customer table represents people who have transacted; mixing prospects pollutes reports and CAC math |
| Inventory vouchers as their own model family | Receipt/issue/transfer/adjustment as voucher records | Adjustments via raw stock writes | Auditable, reversible, supports multi-line and multi-warehouse moves |
| Order source filter on invoices | Single field on invoice indicating channel | Separate invoice tables per channel | One invoice list; cleaner reports; channel is a lens, not a different document |
| Tally → Accountancy rename | Module renamed end-to-end (routes, folders, docs) | Keep "Tally" label | "Accountancy" is the universally recognised term outside the India accounting subculture; "Tally" was carried over from the inspiration product and confused new readers |
| Multi-branch inventory dimension | `InvProductBranch` cache + `InvStockLedger.branchId` required | Single global stock | Real shops have multiple branches; per-branch stock is the operational reality and reports need to roll up multi-branch |
| Naming-convention token engine | Per-installation rule chain stored in DB | Hardcoded "{brand} {model}" | Different shops have wildly different SKU and product-name conventions; rules editable from `/office/admin/naming-convention` |
| Counter-based POS till (not user-based) | Till GL account belongs to `PosCounter`, shared across cashiers | One till account per user | Real shops have shared physical drawers; cashier rotation is the norm; variance accountability lives in the shift report, not the ledger |
| Multi-staff shift lifecycle | OPEN → AWAITING_HANDOVER → CLOSED with PosHandover record | Single open-and-close model | Two-shift days (morning / evening) need a clean handover with cash count + variance JE; A initiates, B verifies and accepts |
| Same-user crash recovery | Return existing shift with `resumed: true` (HTTP 200) on POST /shifts | Hard 409 conflict | Browser crashes happen; forcing the cashier to wait for IT to clear the lock would block billing. Same user + same counter = trust the resume |
| Session-independent POS billing | Read `branchId` from `shift.branchId`, not the active-branch cookie | Cookie-based active branch | Lets the same user run two browsers / two counters in parallel without the cookie interfering — supports pop-up POS windows |
| POS sale return three-tier lookup | By invoice # / by customer / lost invoice (manager bypass) | Single "find invoice" flow | Real returns happen with or without the original bill; lost-invoice case needs manager discretion + reason audit; cashier path stays fast for common case |
| Lost-invoice return is manager-bypass | `pos:shift:manage` perm + reason required + `returnOfId: null` | Cashier-allowed with audit log only | Lost-bill returns are higher fraud risk; gating to managers + requiring reason creates a paper trail without blocking legitimate returns |
| Return refund as CASH or CREDIT | CASH (`Dr Revenue / Cr Till`, requires open shift) or CREDIT note (`Dr Revenue / Cr AR`) | Always cash / always credit | Customer preference varies; both legs reverse the original sale's GL correctly with a single JE; exchange is just a credit note followed by a new sale |
| `Invoice.returnOfId` self-FK | Self-relation on Invoice | Separate `Return` model | Returns ARE invoices (with negative totals), just linked back to the original. One invoice list, one number generator, one print template |
| `InvoiceLine.productId` nullable FK | Optional FK so legacy / service lines without products are still valid | Required FK | Some legacy invoice lines are pure-service (no product); making it required would break the migration |
| POS register at `/vouchers/pos` only | Standalone shell + sidebar new-tab link | Both `/office/pos` and `/vouchers/pos` | One screen, two access points (new-tab from sidebar; opened directly on a dedicated terminal). Avoids duplicating layout work |
| `ModuleChild.newTab` for sidebar new-tab links | Renders `<a target="_blank">` when set | Always `<Link>` | Standalone surfaces (POS register) want their own browser tab so the office stays open; rest of the office is same-window navigation |
| `dynamic = "force-dynamic"` on voucher /new pages | Per-page export on non-`(gl)` voucher new pages | Wrap all in a `(gl)`-style layout | Minimal change; the 6 pages aren't grouped by anything other than convenience; a unifying layout would be a bigger refactor |

---

## 📁 Project Structure

> Detailed, maintained structure reference now lives in `ARCHITECTURE.md`. Keep this section as a high-level snapshot.

```
src/
├── app/
│   ├── (protected)/                 # Staff shell (auth + sidebar)
│   │   ├── layout.tsx               # ProtectedLayout with UniversalCreateMenu
│   │   └── office/                  # Staff URLs: `/office/*`
│   │       ├── (core)/
│   │       │   ├── assignments/     # Primary work surface; me/team/org scopes
│   │       │   ├── call-log/        # Inbound/outbound call log with filters
│   │       │   ├── search-slno/     # Device serial number search
│   │       │   └── accounts/        # Legacy account pages (bridge)
│   │       ├── (repairing)/
│   │       │   ├── dashboard/       # Role-specific dashboards (pipeline context)
│   │       │   ├── tickets/         # Ticket list (pipeline-filtered) + detail
│   │       │   ├── service-centers/ # Service centre CRUD
│   │       │   └── settings/        # pipelines, statuses, sub-statuses
│   │       ├── (customer)/
│   │       │   ├── customers/       # Individual customer list + detail
│   │       │   ├── companies/       # Company list + detail
│   │       │   ├── all/             # Unified customers + companies view
│   │       │   └── leads/           # CRM lead pipeline (kanban + detail)
│   │       ├── (message)/
│   │       │   └── inbox/           # Real-time inbox (Supabase Realtime)
│   │       ├── accountancy/         # Was `(tally)/tally/` — renamed end-to-end 2026-05-07
│   │       │   ├── account-groups/ + ledgers/        # Chart of accounts hierarchy
│   │       │   ├── invoices/                         # Invoice list (filter by order source)
│   │       │   ├── journal-entries/                  # Journal voucher list (three-tier delete)
│   │       │   ├── opening-balance/                  # Manual opening balance entry
│   │       │   └── reports/                          # cash-book, bank-book, bank-reconciliation,
│   │       │                                         # cash-flow, fund-flow, ratio-analysis, statistics,
│   │       │                                         # receivables, payables, ledger-outstandings/[id],
│   │       │                                         # day-book, balance-sheet, profit-loss, trial-balance,
│   │       │                                         # gst/ (hub) + hsn-summary, inward-supplies,
│   │       │                                         # outward-supplies, liability
│   │       ├── inventory/           # Product CRUD + masters + naming-convention + stock-summary
│   │       │   ├── products/                         # Product list / form (with naming-convention auto-fill)
│   │       │   ├── masters/                          # Brand, model, unit, category, warranty term, etc.
│   │       │   ├── configure/                        # Naming convention, stock methods, year-ending
│   │       │   └── stock-summary/                    # Multi-branch stock rollup
│   │       ├── pos/                 # POS shifts + counters admin (NO /office/pos page — register is at /vouchers/pos)
│   │       │   └── shifts/                           # Shift report list + [id] audit page
│   │       ├── (social)/
│   │       │   └── users/[id]/      # Staff profile page with wall posts
│   │       ├── admin/
│   │       │   ├── users/           # User management + permissions modal
│   │       │   ├── branches/ + departments/ + roles/  # Org + RBAC settings
│   │       │   ├── counters/        # POS counter CRUD (creates till GL account)
│   │       │   ├── naming-convention/  # Inventory product naming token rules
│   │       │   ├── year-ending/     # Financial year close + carry-forward
│   │       │   ├── org-chart/       # Visual org hierarchy
│   │       │   ├── posts/           # Internal notice board
│   │       │   └── role/            # Single-role matrix page
│   │       └── ecommerce/           # Staff product + order management
│   ├── (protected)/
│   │   └── vouchers/                # Voucher screens (mix of office-layout and standalone shells)
│   │       ├── (gl)/                # GL voucher route group with own auth-validated layout (forces dynamic)
│   │       │   └── sales/new, purchases/new, sale-returns/new, purchase-returns/new,
│   │       │       estimates/new, payments/new, receipts/new, contras/new,
│   │       │       credit-notes/new, debit-notes/new, journal-entries/new
│   │       ├── pos/                 # Standalone POS register (`fixed inset-0`, no sidebar)
│   │       │   ├── layout.tsx       # SessionWrapper + Toaster
│   │       │   └── page.tsx         # → PosScreen
│   │       ├── challans/new + grn/new + purchase-orders/new + rejections-in/new +
│   │       │   rejections-out/new + sales-orders/new   # Inventory vouchers; each exports `dynamic = "force-dynamic"`
│   │       ├── sales/ + purchases/ + sale-returns/ + purchase-returns/ + estimates/   # Voucher list pages
│   │       └── payments/ + receipts/ + contras/ + credit-notes/ + debit-notes/ + journal-entries/   # GL voucher list pages
│   ├── (external)/                  # Public/customer-facing surface (no staff auth)
│   │   ├── layout.tsx               # ExternalRootShell (SessionProvider for portal)
│   │   ├── (store)/                 # Store homepage sub-group
│   │   │   └── page.tsx             # Marketing homepage (hero, deals, featured, brands)
│   │   ├── shop/                    # Shop sub-surface (own layout)
│   │   │   ├── layout.tsx           # ShopHeader + ShopFooter
│   │   │   ├── page.tsx             # Product listing / catalog
│   │   │   ├── product/[handle]/    # Product detail (tabs: overview, specs, gallery)
│   │   │   ├── cart/                # Cart page (Zustand shopCartStore)
│   │   │   ├── wishlist/            # Wishlist page (Zustand shopWishlistStore)
│   │   │   ├── compare/             # Side-by-side compare (Zustand shopCompareStore)
│   │   │   ├── checkout/            # Checkout + Razorpay payment
│   │   │   └── order/[id]/          # Order confirmation page
│   │   ├── login/page.tsx           # Customer sign-in (`/login`; credentials-portal)
│   │   └── portal/                  # Customer portal sub-surface (own layout)
│   │       ├── layout.tsx           # PortalAppShell
│   │       ├── page.tsx             # Portal home
│   │       ├── register/            # Portal self-registration
│   │       └── tickets/             # Customer's repair ticket list
│   ├── api/
│   │   ├── tickets/[id]/            # GET, PUT, sub-status, warranty, reopen, notes, assign, participants, transfer
│   │   ├── sub-statuses/            # CRUD + transitions + next (pipeline/warranty filtered)
│   │   ├── sub-status-groups/       # Group CRUD for sub-status organisation
│   │   ├── ticket-statuses/         # Main status CRUD + transitions
│   │   ├── pipelines/               # Pipeline CRUD
│   │   ├── customers/[id]/          # Customer CRUD
│   │   ├── companies/[id]/          # Company CRUD + links
│   │   ├── accounts/[id]/           # Legacy account endpoints + relationships
│   │   ├── inbox/rooms/             # Room listing + messages (Supabase-backed)
│   │   ├── users/[id]/              # roles, permissions, activity, wall, password endpoints
│   │   ├── roles/[id]/              # permissions + labels endpoints
│   │   ├── branches/ + departments/ # Org structure CRUD
│   │   ├── org-chart/               # Hierarchical org data
│   │   ├── call-logs/               # Call log CRUD
│   │   ├── notifications/           # Per-user notification list + mark-read
│   │   ├── posts/ + wall-posts/     # Notice board + user wall posts
│   │   ├── search-slno/             # Device serial number search
│   │   ├── upload-signature/        # Cloudinary signed upload params
│   │   ├── finance/                 # account-groups, ledgers, journal, invoices, vouchers
│   │   │   └── reports/             # cash-flow, fund-flow, ratio-analysis, statistics,
│   │   │                            # gst-summary, gst-hsn-summary, payables, receivables,
│   │   │                            # ledger-outstandings/[ledgerId]
│   │   ├── inventory/               # Product CRUD, voucher CRUD (receipt/issue/transfer/adjust)
│   │   ├── crm/                     # CRM leads
│   │   ├── shop/                    # Public shop: products (now from InvProduct), orders, Razorpay
│   │   ├── ecommerce/               # Staff ecommerce: products + orders (uses InvProduct)
│   │   └── portal/                  # Customer portal: register, tickets, password-reset
│   └── staff/login/page.tsx         # Staff sign-in (`/staff/login`; credentials-staff)
├── modules/                         # Domain modules
│   ├── core/                        # Shared business logic
│   ├── customer/                    # Customer + Company + Leads components/lib
│   ├── message/                     # Inbox components + lib/inbox.ts
│   ├── repairing/                   # Ticket, assignment, dashboard components
│   ├── accountancy/                 # Was `tally/` — renamed 2026-05-07; BookPage, GstSummaryView, PartyCombobox,
│   │   │                            # SaleVoucherPage (full-page voucher shell with Suspense wrapper),
│   │   │                            # JournalVoucherDialog, ContraDialog, MoneyFlowDialog (Payment/Receipt/CN/DN)
│   │   └── lib/                     # outstandings, openingBalance, aggregateLedger, balance (nextRef/balanceDelta/toNumber),
│   │                                # postContra, postInvoiceJe, postInvVoucher, refResolver, seedVoucherSeries
│   ├── inventory/                   # InvProductCombobox, InvProductPicker, InvVoucherForm/Detail,
│   │   │                            # InvProductFormFields (with naming-convention auto-fill via dirty refs)
│   │   └── lib/                     # stock (invNextRef), stockValue helpers
│   ├── pos/                         # POS register UI + lib
│   │   ├── components/              # PosScreen, ActiveShiftBar, ShiftOpenDialog, ShiftCloseDialog,
│   │   │                            # HandoverAcceptDialog, CashDropDialog, PosReturnDialog
│   │   └── lib/                     # postPosReceiptJe, shiftMath
│   ├── shared/                      # Cross-module shared utilities
│   └── external/                    # Customer-facing surface components
│       ├── ExternalRootShell.tsx    # Root layout shell with SessionProvider
│       ├── shop/                    # ShopHeader, ShopFooter, ProductCard, AddToCartButton, etc.
│       ├── store/                   # HeroCarousel, DealOfTheDay, FeaturedRow, BrandStrip, etc.
│       └── portal/                  # PortalHeader
├── components/                      # App-level shared components
│   ├── UniversalCreateMenu.tsx      # Floating "+" create menu in layout
│   ├── QuickTicketButton.tsx        # Pipeline-aware quick ticket creation
│   ├── Sidebar.tsx                  # Collapsible Settings; dynamic pipeline nav
│   ├── InboxModule.tsx              # Slack-style real-time chat UI
│   └── ui/                          # shadcn primitives (Neo Brutalism patched)
├── lib/
│   ├── prisma.ts
│   ├── permissions.ts
│   ├── auth-guard.ts                # requirePermission() for staff routes
│   ├── portal-auth-guard.ts         # requirePortalAuth() for portal routes
│   ├── make-permission-layout.tsx   # Factory for permission-gated layout wrappers
│   ├── permission-scope.ts          # Scope-aware permission helpers
│   ├── ticket-scope.ts              # Ticket visibility scoping helpers
│   ├── supabase-client.ts           # Supabase singleton for Realtime
│   ├── money-inr.ts                 # ₹ formatting (paise → display string)
│   ├── format-date.ts / time-ago.ts
│   ├── auth/                        # Auth helpers
│   │   ├── authorize-staff.ts       # Staff credential validation
│   │   ├── authorize-portal.ts      # Portal credential validation (bcrypt)
│   │   ├── portal-identifier.ts     # Phone/email normalisation
│   │   └── staff-email-allowlist.ts
│   └── shop/                        # Shop helpers
│       ├── store-content.ts         # Homepage content config (hero, brands, etc.)
│       ├── product-public.ts        # Public product queries
│       ├── demo-catalog-seed.ts     # Seed data helper
│       ├── demo-reviews.ts          # Static review data for UI
│       └── shop-image-placeholder.ts
├── store/                           # Zustand stores
│   ├── quickTicketStore.ts          # Staff quick-ticket creation state
│   ├── referenceStore.ts            # Reference data cache
│   ├── createDialogStore.ts         # Unified person/company create-modal state
│   └── external/                   # Customer-facing stores (localStorage-persisted)
│       ├── shopCartStore.ts
│       ├── shopWishlistStore.ts
│       └── shopCompareStore.ts
├── utils/
│   └── constants.ts                 # Centralised: COLOR_OPTIONS, WARRANTY_SCOPE_OPTIONS, GL types, fmt()
├── auth.ts / auth.d.ts
└── proxy.ts                         # Auth middleware: `/portal/login` → `/login`; staff vs customer sign-in routing; staff post-login → `/office/core/assignments`
prisma/
├── schema/                          # Split Prisma schema (*.prisma by domain)
│   ├── base.prisma                  # Core CRM: Customer, Company, CustomerCompany (+ GST fields)
│   ├── users.prisma / rbac.prisma / org.prisma
│   ├── pipeline.prisma / tickets.prisma / accounts.prisma
│   ├── finance.prisma               # Invoice (+ returnOfId self-FK), InvoiceLine (+ productId FK), JournalEntry,
│   │                                # Voucher, Payment, Account/AccountGroup, etc.
│   ├── inbox.prisma / enums.prisma  # enums: GstRegType, Taxability
│   ├── inventory.prisma             # InvProduct (unified, w/ HSN+gstRate+taxability+attrsJson+namingConfig),
│   │                                # InvProductBranch (per-branch stock cache), InvVoucher, InvVoucherLine,
│   │                                # InvStockLedger (with branchId)
│   ├── pos.prisma                   # PosCounter, PosShift, PosCashDrop, PosHandover
│   ├── crm.prisma                   # CrmLead model
│   ├── social.prisma                # WallPost model
│   ├── shop.prisma                  # ShopOrder, ShopOrderLine (product comes from InvProduct)
│   └── portal.prisma                # CustomerPortalCredential
├── prisma.config.ts                 # schema path + datasource + seed command (= prisma db seed → bootstrap-seed.ts)
├── seeds/
│   ├── bootstrap-seed.ts            # Production seed (RBAC, pipelines, statuses, branches, departments, COA, DB constraints)
│   ├── dummy-*.ts                   # Manual demo seeds: dummy-users, dummy-shop, dummy-inventory, etc.
│   ├── hard-clean.ts                # `pnpm seed:hard-clean` — wipe everything bootstrap doesn't seed
│   └── data/                        # Fixture data (hardcoded product lists, demo content)
└── migrate-accounts.ts
```

---

## 🔗 External Resources

- **Supabase project**: PostgreSQL database (aws-1-ap-south-1.pooler.supabase.com)
- **Next.js 16 docs**: `node_modules/next/dist/docs/`
- **NextAuth v5 docs**: https://authjs.dev/
- **Prisma docs**: https://www.prisma.io/docs/
