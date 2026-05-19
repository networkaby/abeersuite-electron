# PROJECT BRAIN — ServiceMgmt

> Internal business OS for a multi-channel computer & CCTV shop — retail (in-store + online), wholesale, and a repair service centre on one shared inventory and accounting backbone.

**Stack:** Next.js 16.2.3 (App Router, Turbopack), React 19, PostgreSQL (Supabase), Prisma 7.7.0 (split schema), NextAuth v5 beta (JWT), Tailwind v4, shadcn/ui, Zustand 5, Sonner, Axios, React Hook Form, Zod, Razorpay, Cloudinary, Sentry.
**Repo:** `D:\our-own-website\service-mgmt-experiment` — branch `dev`.
**Started:** 2026-04-17.
**Last updated:** 2026-05-19.

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

_None._ Last batch (Admin V1 + Day Book V1 + voucher registers) shipped through 2026-05-19. Pick the next item from §"Next up" below.

---

## 🆕 Recently shipped (last ~10)

Older history lives in `git log`. This section is trimmed; don't grow it past ~10 entries.

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
- **2026-05-15 — `/lab` experiment**: Front Office / Back Office prototype, customer concierge, universal customer panel, persistent search list, device search. Prototype only, not production. `6207ed9`–`fd4c1b5`.
- **2026-05-15 — Role-aware `/office` home** (4-layer, universal customer panel, department briefings). `1fd703f`, `152bd7e`.

For the milestone log (M1–M26) prior to 2026-05-14, read `git log` or earlier revisions of this file.

---

## 📋 Next up (prioritised)

1. **Doc consistency sweep** — keep this file as the only source of status; resist re-adding "shipped" markers to module docs.
2. **`/lab` decision** — promote to a real `/office` module, fold into existing nav, or delete. It currently lives undefined.
3. **POS follow-ups**: return receipt print page (`/receipt/return/[id]`); multi-partial-return guard (subtract prior returns from per-line cap); stuck-shift auto-close cron; per-row bank account picker for UPI/Card.
4. **Repair-side reporting** — tickets by status/pipeline, avg resolution, technician workload. Finance side is covered; repair side is bare.
5. **Branch-scoped data filtering** — permissions exist but ticket/customer/invoice queries don't filter by `branchId`.
6. **Ticket list pagination** — current list loads all rows.
7. **Accountancy Phase 5b** — GSTR-1/3B export, e-Invoice (IRN) integration, RCM on purchases.
8. **Portal ticket detail** — full notes + status history, not just the list.
9. **Stock decrement on shop order confirm** — now possible since `InvProduct` is unified and multi-branch stock is live.
10. **Razorpay payment status page** — post-payment redirect with real-time polling.
11. **`/api/finance/*` → `/api/accountancy/*`** rename (still deferred from the 2026-05-07 module rename).
12. **Schema migration hygiene** — GST/HSN + naming-convention columns were added via `db push`, no migration. Needs a proper migration before any prod deploy.
13. **Long-term**: SLA alerts; B2B Company portal; ERP module foundation; per-customer pricing tiers; credit-limit enforcement.

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
