# PROJECT BRAIN — ServiceMgmt

> Internal business OS for a multi-channel computer & CCTV shop — retail (in-store + online), wholesale, and a repair service centre on one shared inventory and accounting backbone.

**Stack:** Next.js 16.2.3 (App Router, Turbopack), React 19, PostgreSQL (Supabase), Prisma 7.7.0 (split schema), NextAuth v5 beta (JWT), Tailwind v4, shadcn/ui, Zustand 5, Sonner, Axios, React Hook Form, Zod, Razorpay, Cloudinary, Sentry.
**Repo:** `D:\our-own-website\service-mgmt-experiment` — branch `dev`.
**Started:** 2026-04-17.
**Last updated:** 2026-06-01.

This file is the **only doc that carries status**. Architecture lives in [ARCHITECTURE.md](ARCHITECTURE.md). Setup/runbook lives in [README.md](README.md). Contributor rules live in [AGENTS.md](AGENTS.md). For the authoritative history, read `git log`.

---

## 🎯 Goal

Replace paper/spreadsheets across the whole business with one app:

- **Repair tickets** — Received → Diagnosing → Repairing → … → Returned, with role handoffs (Front Desk, Technician, Despatch, Admin).
- **Accounting** — Tally-style GL: vouchers, GST/HSN, BS / P&L / Day Book / Trial Balance, audit trails.
- **Unified inventory** — one `InvProduct` master feeds storefront, repair, POS, wholesale.
- **POS** — counter-based tills, shift lifecycle, sale returns.
- **CRM & leads** — kanban pipeline reusing the Ticket engine.
- **Customer shop + portal** — `/shop` + `/portal` (separate `CustomerPortalCredential` auth).
- **Org / RBAC** — multi-branch, multi-department, rank-gated roles with `area:operation:scope` permissions.

---

## 🔄 In flight

- **2026-05-29 — Backup & Restore → Dropbox, fire-and-forget** (on `dev`, PR pending). `pg_dump`/`pg_restore` run in GitHub Actions; the dump is stored in / read from **Dropbox** instead of Supabase Storage; the UI only triggers the run and no longer polls (close the page anytime). Backup lands in Dropbox; restore picks from a Dropbox list. New `src/shared/lib/backup/dropbox.ts` + `/api/settings/restore/list`; removed `/backup/status`, `/restore/upload-url`, `/restore/status`, `backupStorage.ts`. **Pending before prod:** one-time Dropbox scoped-app setup (`DROPBOX_APP_KEY/SECRET/REFRESH_TOKEN`) in GitHub secrets + Vercel env, then merge `dev → main`.

---

## 🆕 Recently shipped (last ~10)

Older history lives in `git log`. This section is trimmed; don't grow it past ~10 entries.

- **2026-06-03 — Additional-cost (shipping/courier) allocation layer**: a decision-support layer that attributes already-booked courier expense to products as a per-unit cost for **pricing & margin only — it never posts to the GL** (accountancy stays untouched, the owner's hard constraint). Nominate an `AccountGroup` as the pool (`OrgDefaults.shippingPoolGroupId`); every POSTED debit to a ledger under it is a waiting "entry". New `/office/pricing-strategy/costing` page: per entry, **Allocate** the product-freight share — voucher-driven (`AllocateVoucherDialog` + `costing/draws/batch`): pick the PURCHASE/GRN voucher and spread freight across its product lines via per-unit inputs (by-value / by-qty auto-distribute) — and/or **Dismiss** the office-courier remainder so it leaves the waiting list (one courier bill often covers both). Draw history is inline-editable. New `AdditionalCostAllocation` model (`additional_cost_allocations`, kind `ALLOCATION|DISMISSAL`, rows against a `JournalLine` debit + `sourceInvVoucherId`) + `AdditionalCostAllocationKind` enum + `costPool.ts` (LAST-allocation derive rule) + `costing/pool` & `costing/draws`(+`[id]` DELETE) APIs. `items` API now exposes per-unit `additionalCostPaise` (separate from the pristine `resolvedCostPaise`); `additiveMargin.ts` `additivePriceWithSurcharge` folds it in **before** GST; Items + Update & Print Labels reflect it in Computed/Profit. Pool-group selector on the Org Defaults settings form. Dummy demo in `dummy-vouchers.ts`. **Sale/POS margin display deferred** (protected surface). See [docs/modules/pricing-strategy.md](docs/modules/pricing-strategy.md).
- **2026-06-03 — Per-customer credit limit edit UI**: `Account.creditLimit` is no longer dormant — `PATCH /api/accounts/[id]` now writes it (gated by `customers:edit:org` for a person ledger, `companies:edit:org` for a company), and a new `AccountCreditLimitCard` ([src/modules/customer/components](src/modules/customer/components/AccountCreditLimitCard.tsx)) sits on both the Person and Company **Profile** tabs. `GET /api/person/[id]` and `GET /api/companies/[id]` now pass `creditLimit` through. Deny-by-default semantics preserved (blank/0 = cash-only, positive = credit headroom); enforcement at sale time via `checkCreditLimit` is unchanged. See [docs/modules/people.md](docs/modules/people.md).
- **2026-06-01 — Loyalty v1 (POS earn + redeem wallet)**: new `loyalty.prisma` (config singleton + per category/group/product earn-rule multipliers + per-customer account + lots + audit ledger), `src/modules/loyalty/{lib,components}`, and five `/api/loyalty/*` routes. Identified customers earn points on POS sales (rate resolves product→group→category→global) and redeem them as a bill discount. **Expiry is dynamic + lazy** (no cron): a lot is valid iff `earnedAt > now − expiryDays`, computed live — raising the window revives recently-lapsed points, lowering it drops them; balance is never cached. Config matches+beats Vyapar's reward screen (min-invoice-to-earn, min-invoice-to-redeem, expiry on/off in days, min-points). **Earning is GL-silent**; **redemption** posts to a seeded **"Loyalty Points Redeemed"** expense ledger via a negative `InvVoucherCharge` (the protected `postInvVoucherToGl` math is reused unchanged); outstanding points are shown as a read-only **memo liability** (not booked). Admin hub at `/office/customer-retention/loyalty` + a Loyalty tab on the customer profile. New permission `loyalty:manage`. Also **fixed a latent POS bug**: the tier discount was computed client-side but never sent, so any tier > 0% failed the server payment-total check — `/api/pos/sale` now accepts `discountAmt` (→ Discount Allowed). v1 is POS-only; low-margin protection is manual (set loss-makers to 0×). See [docs/modules/loyalty.md](docs/modules/loyalty.md).
- **2026-05-21 — GL engine reference split**: every `JournalEntry` auto-created by the posting engine (Sale, Purchase, POS, Receipt, Payment, Contra, user JV, returns, shift variance, e-commerce JE, reversal JE) now uses a new `GL_POSTING` VoucherSeries with reference prefix `GL-…` (was `JE-…`, which visually collided with the user's Journal Voucher). The user Journal Voucher series locks to `JV-…`. `GET /api/accountancy/journal-entries` hides engine output by default (`?includeEngine=1` to inspect); `POST /api/accountancy/journal-entries` is deprecated and returns 410 — all user journals go through `/api/accountancy/journal-vouchers`. Day Book duplicates (one row per sale + a second "JOURNAL" row) are gone. Voucher/InvVoucher table split kept intentionally — see [accountancy.md](docs/modules/accountancy.md) "Two engines" + "Why two voucher tables" sections.
- **2026-05-20 — Admin + Settings V1.5 (in-section nav)**: `office/admin/layout.tsx` + `AdminNav` and `office/settings/layout.tsx` + `SettingsNav` — permission-filtered grouped tab bars (same pattern as voucher registers), sourced from `ADMIN_NAV` / `SETTINGS_NAV` in `constants.ts`. Admin `loading.tsx` skeleton keeps nav visible while page content loads.
- **2026-05-20 — Settings module extracted from Admin**: 7 pages (pipelines, statuses, sub-statuses, org-defaults, year-ending, naming-convention, printer-settings) + `OrgDefaultsForm` moved to `/office/settings/*` and `src/modules/settings/`. New [docs/modules/settings.md](docs/modules/settings.md). Hard cut, no compat redirects from old `/office/admin/<page>` URLs. `next.config.ts` cleaned up to avoid hijacking the new `/office/settings/*` paths.
- **2026-05-19 — Admin module V1**: branches/departments/posts/org-chart terminology cleanup, ID labels, dummy-org seeding. Commits `bb4dfd3`, `2d3f455`, `03826b2`, `e4ae844`.
- **2026-05-18 — Auth + welcome**: `BranchRequired` gate, welcome page; removed thermal-relay tools. `71e5c67`.
- **2026-05-18 — Voucher top-bar / action-bar**: `VoucherTopBar`, `VoucherActionBar`, `VoucherInlineActions` wired across inventory + finance voucher pages. `93576f2`, `9bfe84c`.
- **2026-05-18 — Branch Transfer voucher + Manufacturing Journals + Physical Stock**. `eb13618`, `eff0356`.
- **2026-05-18 — Bill of Materials (BOM)** in inventory + new voucher types. `28a91fe`.
- **2026-05-17 — Day Book V1**: presets, expanded rows, persisted filters, breadcrumb nav, draft/cancelled status beside type. Multiple commits in `bafd709`–`16a1e48`.
- **2026-05-17 — Voucher registers**: shared `VoucherRegisterTable` + `voucherUrls`, duplicate-handoff flow, Pending Vouchers report, editable GL voucher pages, UTC date bug fix. `5cac4b1`, `ca6c966`, `bafd709`, `396f4d5`.
- **2026-05-16 — Tax Classification report** (`/office/accountancy/reports/gst/classification`) with four tabs. `649781d`.
- **2026-05-16 — Inventory GST/HSN cascade**: product → group chain → org default → null. `44d5327`.
- **2026-05-16 — Thermal print**: direct ESC/POS for POS receipts, browser fallback for vouchers. `e8ab923`.

For the milestone log (M1–M26) prior to 2026-05-14, read `git log` or earlier revisions of this file.

---

## 📋 Next up (prioritised)

1. **Doc consistency sweep** — keep this file as the only source of status; resist re-adding "shipped" markers to module docs.
2. **`/lab` decision** — promote to a real `/office` module, fold into existing nav, or delete. It currently lives undefined.
3. **POS follow-ups**: return receipt print page (`/receipt/return/[id]`); multi-partial-return guard (subtract prior returns from per-line cap); stuck-shift auto-close cron; per-row bank account picker for UPI/Card.
4. **Outstandings — Pay Now / Receive Now action** — on `/office/accountancy/reports/ledger-outstandings/[id]` (and the Receivables/Payables bill-wise tabs), add a per-row "Receive Now" (debtors) / "Pay Now" (creditors) button that opens a pre-filled Receipt/Payment voucher with the bill auto-allocated. Saves the user from copy-pasting the bill ref + amount into a blank voucher.
5. **Repair-side reporting** — tickets by status/pipeline, avg resolution, technician workload. Finance side is covered; repair side is bare.
6. **Branch-scoped data filtering** — permissions exist but ticket/customer/invoice queries don't filter by `branchId`.
7. **Ticket list pagination** — current list loads all rows.
8. **Accountancy Phase 5b** — GSTR-1/3B export, e-Invoice (IRN) integration, RCM on purchases.
9. **Portal ticket detail** — full notes + status history, not just the list.
10. **Stock decrement on shop order confirm** — now possible since `InvProduct` is unified and multi-branch stock is live.
11. **Razorpay payment status page** — post-payment redirect with real-time polling.
12. **`/api/finance/*` → `/api/accountancy/*`** rename (still deferred from the 2026-05-07 module rename).
13. **Credit-limit enforcement on the office Sale voucher** — credit is now deny-by-default (NULL/0 = no credit; only a positive limit permits credit), but `checkCreditLimit` is wired **only** into the POS sale path. The office Sale voucher (`/api/inventory/vouchers`, SALE) still creates credit sales with no check, bypassing the limit. Add `checkCreditLimit(tx, accountId, onCredit)` inside that route's transaction (mirrors `src/app/api/pos/sale/route.ts:226`). Note: this is a behaviour change to a protected accountancy surface — it will start *blocking* office credit sales that exceed the limit, so confirm before shipping.
13. **Schema migration hygiene** — GST/HSN + naming-convention columns were added via `db push`, no migration. Needs a proper migration before any prod deploy.
14. **Franchisee support** — model independent shops that use your brand but are separate legal entities (own PAN, own GSTIN). Distinct from company-owned `Branch` (same legal entity, your stock, your cash, your books) on every dimension that matters: a franchisee is a `Company` row under Sundry Debtors, sales to them are real B2B vouchers (IGST / CGST+SGST per state), their end-customer sales never enter your books, and royalty is a separate ledger. Smallest first step: add `isFranchisee Boolean @default(false)` + `royaltyPercent Decimal?` + `franchiseStartedAt DateTime?` on `Company`; surface a "Franchisee" filter / badge in customer lists; partner-portal access (one login per franchisee proprietor) reusing existing customer-portal infra. Bigger follow-ups: monthly royalty invoice generation, stock advisory dashboards, contract documents. See chat 2026-05-23 for the full company-owned-vs-franchisee comparison.
15. **Loyalty points** — earn/redeem points on POS + shop sales; per-customer balance, configurable accrual rate, redemption as discount or store credit; ledger-backed so liability shows on the books.
16. **Long-term**: SLA alerts; B2B Company portal; ERP module foundation; per-customer pricing tiers; credit-limit enforcement.

---

## 🧠 Key decisions

| Area | Choice | Why |
|---|---|---|
| Framework | Next.js 16 App Router | Server + client co-location; Turbopack for dev speed. |
| ORM | Prisma split schema | One datasource, modular schema files. |
| Auth | NextAuth v5 JWT, two providers | Staff and portal credentials never crossover; `CustomerPortalCredential` is a separate table. |
| State | Zustand + localStorage for client carts | No server round-trip until checkout. |
| Money | Integer paise everywhere | Avoid float drift; format with `moneyInr.ts`. |
| Accounting model | `AccountType → AccountGroup → Ledger` | Tally mental model in code, normalised in DB. |
| Suspense ledger | Auto-route opening-balance mismatches | Trial balance always balances during legacy imports. |
| Inventory unification | Single `InvProduct` for shop + warehouse + POS | No sync layer between catalog and stock. |
| POS tills | Counter-based, not user-based | Any cashier can work any counter; variance lands on the counter account. |
| Pipelines | Generic engine reused for Tickets and CRM Leads | Don't dual-write; leads are device-less tickets. |

---

## 💡 Ideas (parking lot)

- Pipeline-specific dashboards per pipeline (Repair / Sales / etc.).
- B2B Company portal — companies see all linked devices/tickets.
- Despatch courier integration — auto-generate tracking label from "Pending Despatch" sub-status.
- SLA alerts — flag tickets stuck too long in a status.
- Position model — named slots in the org chart (needed at 50+ users).
- Per-branch reorder points on `InvProductBranch` (currently global on `InvProduct`).
- GSTIN auto-fill from public GST lookup API when typing a 15-char GSTIN.
- POS exchange as one atomic transaction (currently credit note → new sale).
- Personal till accountability via a user dimension on variance JEs (currently counter-only).

---

## ⚠️ Known gotchas

- **Server restart required after `prisma generate`.** Turbopack caches Prisma client chunks.
- **Middleware is `src/proxy.ts`, NOT `middleware.ts`.** Next.js 16 rename.
- **Split Prisma schema** — `prisma/schema/*.prisma`, configured in `prisma.config.ts`.
- **NextAuth v5 beta** — cast `session.user` for `id`/`role`/`roles`/`permissions`. Never use `getToken()`.
- **Scalar list filtering** — `String[]` uses `{ has: "R3" }` (Postgres only).
- **Sub-status `allowedRoles`** — R1 always bypasses, by design.
- **Opaque IDs** — S1–S10 statuses, SS1–SS37 sub-statuses, R1–R4 roles, P1–P4 priorities, `P-REPAIR` / `P-SALES` pipelines.
- **`@@unique` with nullable fields** — Postgres treats NULL as distinct; `skipDuplicates` is unreliable. Use `findFirst` + `create`.
- **Razorpay** — `RAZORPAY_WEBHOOK_SECRET` must be set in `.env`, otherwise webhooks reject silently.
- **Portal and staff auth never crossover.** Don't reuse staff cookies for portal.
- **Shop prices in paise.** Use `moneyInr.ts` to format. Never divide by 100 inline.
- **Schema added via `db push`, no migration**: GST/HSN columns, naming-convention columns. Migrate before any prod deploy.
- **Legacy `src/modules/tally/`** co-exists with `src/modules/accountancy/`. Rename was 2026-05-07; folder removal is pending separate work.

---

## 🔗 External resources

- Supabase: `aws-1-ap-south-1.pooler.supabase.com`.
- Next.js 16 docs: `node_modules/next/dist/docs/`.
- NextAuth v5 docs: https://authjs.dev/.
