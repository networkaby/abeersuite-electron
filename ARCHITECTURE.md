# Architecture Overview

Current implementation architecture of `service-mgmt-experiment`. Present-tense only — no history, no roadmap. For status, plans, and decisions, see [PROJECT_BRAIN.md](PROJECT_BRAIN.md).

## 1) Runtime architecture

- **Framework**: Next.js App Router (`src/app`).
- **Rendering**: SSR-first pages, client components for interactive UI.
- **Auth middleware**: `src/proxy.ts` (Next.js 16 rename — not `middleware.ts`).
- **API layer**: route handlers under `src/app/api/*`.
- **Data layer**: Prisma + PostgreSQL (Supabase).
- **Realtime layer**: Supabase Realtime for inbox updates.

## 2) Domain modules

Domain modules live in `src/modules/`:

- `core` — shared business workflows (assignment-oriented pages/logic).
- `customer` — customer / company / lead components and helpers.
- `message` — inbox and messaging.
- `repairing` — ticket lifecycle, repair workflow UI.
- `accountancy` — finance and accounting (`PartyCombobox`, `BookPage`, `GstSummaryView`, voucher pages, `outstandings`, `openingBalance`, `aggregateLedger`).
- `inventory` — inventory masters + voucher UI (`InvProductCombobox`, `InvProductPicker`, `InvVoucherForm`, `InvVoucherDetail`, `InvProductFormFields`).
- `pos` — POS register UI (`PosScreen`, `ActiveShiftBar`, `ShiftOpenDialog`, `ShiftCloseDialog`, `HandoverAcceptDialog`, `CashDropDialog`, `PosReturnDialog`).
- `admin` — admin pages (branches, departments, posts, org chart, roles, users, pipelines, counters, naming-convention, year-ending).
- `ecommerce` — staff-side shop admin (products, orders, categories, coupons).
- `external` — customer-facing shop, store homepage, portal UI.
- `lab` — experimental Front Office / Back Office prototype (`/lab`). Not production.

Cross-cutting code lives in `src/shared/`. App-level shadcn primitives live in `src/components/ui/`.

> **Tally legacy**: `src/modules/tally/` still co-exists with `src/modules/accountancy/`. The module was renamed on 2026-05-07; the folder removal is pending.

## 3) Route groups

### Staff app — `/office/*` (requires staff session)

Every directory under `src/app/(protected)/office/` is a real URL segment — URLs mirror the source layout 1:1.

- `admin/` — users, role permission matrix, branches, departments, posts, org-chart, pipelines, statuses, workers, counters, naming-convention, year-ending.
- `core/` — accounts, assignments, call-log, search-slno.
- `customers/` — customers, companies, unified "all" view, transactions tab.
- `crm/` — leads list + detail.
- `message/inbox/` — staff inbox.
- `repairing/` — dashboard, tickets, service centres.
- `social/users/[id]/` — staff profile + wall.
- `accountancy/` — chart of accounts, vouchers (sales / purchase / estimate / contra / payment / receipt / credit-note / debit-note / branch-transfer / manufacturing-journals / physical-stock), invoices, journal entries, ledgers, opening-balance, voucher registers, day book, pending vouchers, reports (cash book, bank book, bank reconciliation, cash flow, fund flow, ratio analysis, statistics, receivables, payables, ledger-outstandings, GST hub including tax-classification, balance sheet, P&L).
- `ecommerce/` — staff shop admin.
- `inventory/` — masters (units, categories, brands, product-groups, warranty-terms, attribute-masters, BOMs, gst-rates), products, stock transactions, stock summary, stock ledger.
- `pos/shifts/` — shift reports. The POS register itself opens at `/vouchers/pos` (standalone window).
- `home/` — role-aware four-layer landing.
- `roadmap/[moduleKey]/` — placeholder hub for future modules.

Staff sign-in: `/staff/login`; post-login redirect to `/office/work-flow-inbox` (see `src/proxy.ts`).

`/office/tally/*` 307-redirects to `/office/accountancy/*` (legacy URL preservation).

### External — public / customer-facing

Grouped under `src/app/(external)`:

- `(store)/` — marketing storefront homepage (hero, deals, featured, brands).
- `shop/` — listing, product detail, cart, wishlist, compare, checkout (Razorpay), order confirmation.
- `portal/` — customer hub (register, tickets, orders, repairs, wallet, wishlist).
- Customer sign-in: `/login` (the `(external)/login/` page). `/portal/login` redirects to `/login`.

### Experimental — `/lab`

`/lab` hosts the Front Office / Back Office prototype (customer concierge, persistent search list, device search). Not gated, not production.

## 4) API topology

### Staff API

- `/api/tickets/*` — lifecycle, worker, notes, reopen, assign, transfer.
- `/api/ticket-statuses/*`, `/api/workers/*`, `/api/worker-groups/*` — workflow config.
- `/api/users/*` — CRUD, roles, permissions, activity, wall posts, password.
- `/api/roles/*`, `/api/permissions/*` — RBAC.
- `/api/branches/*`, `/api/departments/*`, `/api/posts/*`, `/api/org-chart/*` — org structure.
- `/api/customers/*`, `/api/companies/*`, `/api/accounts/*` — customer/company domain (returns GSTIN/state/regType for `PartyCombobox` autofill).
- `/api/crm/leads/*` — CRM lead pipeline.
- `/api/inbox/*` — rooms, read state, messages.
- `/api/accountancy/*` — account groups, ledgers, journal entries (three-tier delete: void/soft/hard), invoices, vouchers (sales/purchases/estimates/branch-transfer/manufacturing/physical-stock), opening balances + Suspense, voucher registers.
- `/api/accountancy/reports/*` — cash-flow, fund-flow, ratio-analysis, statistics, gst-summary, gst-hsn-summary, gst-classification, payables, receivables, ledger-outstandings, pending-vouchers, day-book.
- `/api/inventory/*` — master CRUD (units, categories, product-groups, brands, warranty-terms, attribute-masters, BOMs, gst-rates, products) + voucher CRUD.
- `/api/pos/*` — sale, return (incl. lost-invoice), shifts, snapshots.
- `/api/call-logs/*`, `/api/notifications/*`, `/api/wall-posts/*`, `/api/search-slno/*`, `/api/upload-signature/*`.
- `/api/ecommerce/*` — staff shop admin (uses `InvProduct`).

### Customer-facing API

- `/api/shop/products`, `/api/shop/products/[handle]` — public catalogue.
- `/api/shop/orders`, `/api/shop/orders/[id]/razorpay` — orders + payment init.
- `/api/shop/razorpay/webhook` — HMAC-verified payment webhook.
- `/api/portal/register`, `/api/portal/tickets` — customer self-service.

Validation is Zod-driven on write endpoints. Auth uses guard helpers from `src/shared/lib/auth/` (`requirePermission` for staff, `requirePortalAuth` for portal).

## 5) Auth and authorization

### Staff

- NextAuth config in `src/auth.ts` (`Credentials` provider, JWT strategy).
- Staff provider: `credentials-staff`. Login page: `/staff/login`. After login → `/office/work-flow-inbox` (or `callbackUrl`) via `src/proxy.ts`.
- Session carries role, permissions, rank, scope, branch, department.
- API uses `requirePermission` for fine-grained authorization. Direction is permission-driven, not role-name checks.

### Portal (customer)

- Separate credential table: `CustomerPortalCredential` (linked to `Customer`).
- Sign-in page: `/login` (`src/app/(external)/login/page.tsx`). Provider: `credentials-portal`. Validation in `src/shared/lib/auth/authorizePortal.ts`.
- Guard: `src/shared/lib/auth/portalAuthGuard.ts` (`requirePortalAuth`).
- Portal and staff sessions are fully independent — no crossover.

## 6) Data model

Prisma split schema (`prisma.config.ts` → `prisma/schema/`):

- `base.prisma` — `Customer`, `Company`, `CustomerCompany` with GST fields (`gstin`, `gstStateCode`, `gstRegType`, `financialYearFrom`, `booksBeginningFrom`).
- `users.prisma`, `rbac.prisma`, `org.prisma` — users, roles/permissions, branches/departments/posts, org chart.
- `pipeline.prisma`, `tickets.prisma`, `accounts.prisma` — ticket workflow + legacy `Account` bridge.
- `finance.prisma` — `AccountType`, `AccountGroup`, `Ledger`, `JournalEntry` (with `VOID` / `SOFT_DELETED` status), `Invoice` (with `returnOfId` self-FK), `InvoiceLine` (with `productId` FK), voucher records, opening balances.
- `inventory.prisma` — `InvUnit`, `InvCategory`, `InvProductGroup`, `InvBrand`, `InvWarrantyTerm`, `InvProduct` (with `hsnCode`, `gstRate`, `taxability`, `attrsJson`, `namingConfig` — single source of truth for shop + warehouse), `InvProductBranch` (per-branch stock), `InvVoucher`, `InvVoucherLine`, `InvStockLedger` (with `branchId`), `InvAttribute`, `InvAttributeValue`, `InvBom`, `InvBomLine`, `InvGstRate`.
- `pos.prisma` — `PosCounter`, `PosShift` (OPEN → AWAITING_HANDOVER → CLOSED), `PosCashDrop`, `PosHandover`.
- `crm.prisma` — `CrmLead`.
- `inbox.prisma` — `ChatRoom`, `ChatMessage`.
- `social.prisma` — `WallPost`.
- `shop.prisma` — `ShopOrder`, `ShopOrderLine` (prices in integer paise). No `ShopProduct` — merged into `InvProduct`.
- `portal.prisma` — `CustomerPortalCredential`.
- `enums.prisma` — shared enums (`GstRegType`, `Taxability`, `VoucherStatus`, `EntryType`, `NormalBalance`, …).

> **Migration hygiene**: GST/HSN columns and naming-convention columns were added via `prisma db push` and have no migration recorded. Generate migrations before any production deploy.

## 7) Design rules

- Ticket workflow = primary status + worker handoffs.
- Ownership = primary owner + participant helpers.
- Pipeline model supports multiple workflows (repair, sales, etc.).
- Customer and Company are separated; `Account` is a legacy bridge.
- Finance follows `AccountType → AccountGroup → Ledger`; normalised, not Tally-name-driven.
- GST identity (GSTIN, state code, reg type) lives on `Customer` / `Company`, not a separate `Party` model.
- HSN code and GST rate live on `InvProduct`, not per voucher line.
- `InvProduct` is the single source of truth for shop + warehouse + POS.
- Journal entries support three-tier delete: void (preserve, no GL impact), soft (hide, retain audit), hard (admin only).
- Opening-balance mismatches route into a system "Suspense" ledger so trial balance always balances.
- `CrmLead` represents prospects only; conversion promotes a lead into a `Customer`. No dual write.
- Composition GST parties skip GST lines on sales vouchers regardless of product `gstRate`.
- Shop prices stored as integer paise. Display via `src/shared/lib/format/moneyInr.ts`.
- Portal and staff auth are fully separate; `CustomerPortalCredential` is not on the NextAuth session.
- Razorpay payment confirmation relies on the signed webhook, not the client response.
- Client-side cart / wishlist / compare are Zustand + localStorage (no DB until checkout).
- POS tills are **counter-based**, not user-based. Any cashier on any counter; variance lands on the counter account; human accountability comes from the shift report.

## 8) External module structure (`src/modules/external/`)

- `shop/` — `ShopHeader`, `ShopFooter`, `ShopSearchBar`, `ProductCard`, `AddToCartButton`, `ShopCatalogClient`, `ProductDetailTabs`, `ProductGallery`, `ProductPurchasePanel`, `ShopPageBanner`, `ShopRemoteImage`.
- `store/` — `HeroCarousel`, `DealOfTheDay`, `FeaturedRow`, `BrandStrip`, `TrustStrip`, `CategoryShowcase`, `PromoBanners`.
- `portal/` — `PortalHeader`.
- `ExternalRootShell.tsx` — root layout shell wrapping NextAuth `SessionProvider`.

Cross-boundary imports (external surface importing from staff-side `src/shared/`, `src/components/`, `src/lib/`, `src/store/`) are widespread; the main load-bearing categories are shadcn UI primitives (`@/components/ui/*`), money formatting (`@/shared/lib/format/moneyInr`), product helpers (`@/lib/shop/product-public`), brand constants (`@/utils/constants-company-details`), and zustand stores (`@/store/external/*`). If the customer surface is ever extracted into a separate app, these are the import categories to break.

## 9) Shared structure (`src/shared/`)

Cross-cutting code lives under `src/shared/`. Single-module code lives under `src/modules/<m>/`.

```
src/shared/
├─ components/      cross-cutting UI (Sidebar, Topbar, PartyPicker, BranchSwitcher, etc.)
├─ hooks/           cross-cutting React hooks (index.ts barrel)
├─ types/           cross-cutting type defs (inventoryTypes.ts, orgChart.ts)
└─ lib/
   ├─ api/          validateRequest, parsePagination, prismaUniqueError, handleApiError, generateNextOpaqueId (index.ts barrel)
   ├─ auth/         permissions, authGuard, portalAuthGuard, permissionScope, makePermissionLayout, authorizeStaff, authorizePortal, portalIdentifier, portalAccountContext, staffEmailAllowlist, activeBranch, freeRoutes
   ├─ constants/    accounting.ts, permissions.ts
   ├─ format/       formatDate, timeAgo, moneyInr, numberWords, slugify, utils (cn)
   ├─ prisma/       prismaClient (singleton), fragments
   ├─ portal/       mockAdapters (DTO + mock data — replace as APIs land)
   ├─ schemas/      commonSchemas, inventorySchemas, bomSchemas, orgDefaultsSchemas
   ├─ shop/         storeContent, productPublic, demoReviews, shopImagePlaceholder
   ├─ supabase/     supabaseClient (Supabase singleton)
   ├─ http.ts       fetch wrapper
   └─ orgDefaults.ts
```

**Boundary rule:** code goes in `src/shared/` only if imported by two or more modules (or from `src/app/`). Single-module code lives in `src/modules/<m>/{lib,hooks,components}/`. Promote later, don't speculate.

**Naming:** components `PascalCase.tsx`; hooks `useFooBar.ts` (camelCase); utilities / schemas / constants `camelCase.ts`; directories `kebab-case`.

**Lookup:** before adding a new shared helper, grep `src/shared/` for the keyword. If the folder has an `index.ts`, that's the public surface.

## 10) Project layout

```
src/
├─ app/                              Next.js routes
│  ├─ (protected)/office/*           Staff UI (122 page.tsx files)
│  ├─ (protected)/vouchers/pos/      Standalone POS register
│  ├─ (external)/                    Customer-facing (shop, portal, store, login)
│  ├─ api/*                          ~218 route handlers
│  ├─ lab/                           Experimental Front/Back Office prototype
│  └─ staff/login/                   Staff sign-in
├─ modules/                          Domain modules (see §2)
├─ components/                       App-level wrappers + shadcn UI primitives
├─ shared/                           Cross-cutting (see §9)
├─ store/                            Zustand stores (incl. store/external/* for shop)
├─ utils/constants.ts                Sidebar module sections + general constants
├─ auth.ts                           NextAuth config
└─ proxy.ts                          Auth middleware (Next 16 rename)

prisma/
├─ schema/                           Split Prisma schema (see §6)
├─ prisma.config.ts                  Datasource + seed command
└─ seeds/
   ├─ bootstrap-seed.ts              Production seed (RBAC, statuses, COA, units, warranty, etc.)
   ├─ helper-inventory-masters.ts    Trade-specific reference data (brands, categories, HSN/GST groups)
   ├─ dummy-*.ts                     Manual demo seeds
   ├─ hard-clean.ts                  Reset to bootstrap state
   ├─ purge-vouchers.ts
   ├─ recompute-balances.ts          Recompute Account.balance drift
   └─ data/                          Fixture data
```

## 11) Operational notes

- Use `pnpm`.
- After Prisma schema changes: `prisma generate` and **restart dev server** (Turbopack caches Prisma chunks).
- On Next.js 16, keep auth middleware in `src/proxy.ts`; do not move to `middleware.ts`.
- Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` in `.env`.
- See `docs/seeds.md` for seed lifecycle (`bootstrap`, `dummy-*`, `hard-clean`).
- See `docs/completed-and-protected.md` before touching protected surfaces (POS GL, BS, P&L, Day Book, accounting math).
- For per-module URLs, permissions, models, key components, and gotchas, read `docs/modules/<module>.md`.
