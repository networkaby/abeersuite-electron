# Architecture Overview

This document describes the current implementation architecture of
`service-mgmt-experiment`.

## 1) Runtime Architecture

- **Framework**: Next.js App Router (`src/app`)
- **Rendering model**: SSR-first pages, client components for interactive UI
- **Auth middleware**: `src/proxy.ts`
- **API layer**: route handlers under `src/app/api/*`
- **Data layer**: Prisma + PostgreSQL
- **Realtime layer**: Supabase Realtime for inbox updates

## 2) Domain Boundaries

Core domain modules are in `src/modules`:

- `core` - shared business workflows (assignment-oriented pages/logic)
- `customer` - customer/company/lead domain components and helpers
- `message` - inbox and messaging domain
- `repairing` - ticket lifecycle, repair workflow UI/domain
- `tally` - finance and accounting features (`PartyCombobox`, `BookPage`, `GstSummaryView`, `lib/outstandings.ts`, `lib/openingBalance.ts`, `lib/aggregateLedger.ts`)
- `inventory` - inventory master data + voucher UI (`InvProductCombobox`, `InvProductPicker`, `InvVoucherForm`, `InvVoucherDetail`)
- `shared` - cross-domain reusable module-level pieces
- `external` - customer-facing shop, store homepage, and portal UI components

App-level cross-cutting components live in `src/components` (shadcn UI) and
`src/modules/shared` (e.g. `Sidebar`, `QuickTicketButton`, `UniversalCreateMenu`).

### Tally Domain Note

The `(tally)` domain is inspired by standard Tally workflows but modeled for
application clarity and long-term extensibility:

- group/category semantics are represented through account hierarchy
- ledger usage is represented as concrete account records used in entries
- reporting is generated from journal/invoice/payment data, not from UI-only state

## 3) App Route Groups

### Staff app — protected (requires staff session)

Staff UI lives under **`src/app/(protected)/office/`** and is served at URLs prefixed with **`/office`** (parentheses folders are still Next.js *route groups* and do not appear in the URL).

- **`src/app/(protected)/layout.tsx`** — session gate, customer redirect to `/portal`, shared shell (sidebar, etc.)
- **`src/app/(protected)/office/`** — real path segment **`/office`** in the browser

Route groups under `office/` (each maps under `/office/...`):

- `(admin)` — users, roles, role matrix, branches, departments, org chart, posts, staff ecommerce admin
- `(core)` — assignments, call log, serial number search, accounts
- `(customer)` — customers, companies, unified “all” view, CRM leads
- `(message)` — inbox (`/office/inbox`)
- `(repairing)` — dashboard, tickets, service centers, repair settings (statuses, pipelines, …)
- `(social)` — staff profile pages with wall (`/office/users/[id]`)
- `(tally)` — accounting (`/office/accountancy/...`) — was `(tally)/finance/` → renamed `(tally)/tally/` on 2026-05-07
- `(e-commerce)` — staff shop admin (`/office/ecommerce/...`)
- `(inventory)` — inventory masters (`/office/inventory/...`): units, categories, groups, brands, warranty terms, products (barcode/EAN/UPC slots, HSN/GST fields). Stock transactions live in `(tally)/tally/inventory/`.

Examples: `/office/tickets`, `/office/assignments`, `/office/customers`, `/office/leads`, `/office/accountancy/invoices`, `/office/accountancy/reports/gst`, `/office/inventory/products`.

Staff sign-in: **`/staff/login`** (NextAuth `credentials-staff`); after login, `src/proxy.ts` sends staff to **`/office/assignments`** (or `callbackUrl` when present).

### External surface — public/customer-facing

Pages are grouped under `src/app/(external)`:

- `(store)` - marketing store homepage (hero, deals, featured products, brands)
- `shop/` - product listing, product detail, cart, wishlist, compare, checkout, order confirmation; uses Razorpay for payment
- `portal/` - customer hub (register, ticket tracking, etc.). Customer sign-in UI lives at **`/login`** (not under `/portal`); **`/portal/login`** redirects to **`/login`** for bookmarks.

Parentheses route groups do not add URL segments; public URLs stay **`/`**, **`/shop/*`**, **`/portal/*`** (separate from **`/office/*`**).

## 4) API Topology

### Staff API

- `/api/tickets/*` - lifecycle, status/sub-status, notes, reopen, assign, transfer
- `/api/ticket-statuses/*` and `/api/sub-statuses/*` - workflow configuration
- `/api/sub-status-groups/*` - grouping for sub-statuses in settings UI
- `/api/users/*` - CRUD + roles, permissions, activity, wall posts, password change
- `/api/roles/*`, `/api/permissions` - RBAC
- `/api/branches/*`, `/api/departments/*` - org structure
- `/api/org-chart` - hierarchical org data
- `/api/customers/*`, `/api/companies/*`, `/api/accounts/*` - customer/company domain (now returns GSTIN/state/regType for party-picker autofill)
- `/api/crm/leads/*` - CRM lead pipeline CRUD
- `/api/inbox/*` - room listing, read state, messages
- `/api/finance/*` - account groups, ledgers, journal entries (with three-tier delete: void/soft/hard), invoices, vouchers (sales/purchases/estimates), opening balances + suspense
- `/api/finance/reports/*` - cash-flow, fund-flow, ratio-analysis, statistics, gst-summary, gst-hsn-summary, payables, receivables, ledger-outstandings/[ledgerId]
- `/api/call-logs/*` - inbound/outbound call record CRUD
- `/api/notifications/*` - per-user notification list + mark-read
- `/api/posts/*`, `/api/wall-posts/*` - staff notice board + user wall posts
- `/api/search-slno/*` - device serial number search
- `/api/upload-signature` - Cloudinary signed upload params
- `/api/ecommerce/*` - staff-side product and order management (products come from unified `InvProduct`)
- `/api/inventory/*` - inventory master CRUD (`units`, `categories`, `product-groups`, `brands`, `warranty-terms`, `products`) **plus** voucher CRUD (receipt/issue/transfer/adjust); requires `inventory:manage`.

### Customer-facing API

- `/api/shop/products` + `/api/shop/products/[handle]` - public product catalog
- `/api/shop/orders` + `/api/shop/orders/[id]/razorpay` - order creation + payment initiation
- `/api/shop/razorpay/webhook` - Razorpay payment webhook (HMAC-verified)
- `/api/portal/register` - customer self-registration
- `/api/portal/tickets` - customer's own ticket list

Validation is Zod-driven across most write endpoints. Auth and authorization are
enforced via guard helpers from `src/lib` (staff: `requirePermission`; portal: `requirePortalAuth`).

## 5) Auth and Authorization Model

### Staff auth

- NextAuth config lives in `src/auth.ts` (`Credentials` provider + JWT strategy).
- Staff credentials provider: `credentials-staff`; staff login page: **`/staff/login`** (`src/app/staff/login/page.tsx`). After successful staff login, navigation lands on **`/office/assignments`** (or `callbackUrl`) — see `src/proxy.ts`.
- Sessions include role and permission context (rank, scope, branch, department) for server/UI decisions.
- API endpoints use `requireAuth` for authenticated access and `requirePermission` for fine-grained authorization.
- Current direction is permission-driven authorization rather than role-name checks.

### Portal (customer) auth

- Separate credential table: `CustomerPortalCredential` (linked to `Customer`).
- Customer sign-in page: **`/login`** (`src/app/(external)/login/page.tsx`); NextAuth default `pages.signIn` in `src/auth.ts` is **`/login`**. Portal credentials use `credentials-portal`; validation in `src/shared/lib/auth/authorizePortal.ts`.
- Portal routes are guarded by `src/shared/lib/auth/portalAuthGuard.ts` (`requirePortalAuth`).
- Portal and staff sessions are completely independent — no crossover.

## 6) Data Model and Prisma Layout

Prisma uses split schema mode:

- `prisma.config.ts` points to `prisma/schema`
- schema files include:
  - `base.prisma` - core CRM: `Customer`, `Company`, `CustomerCompany` (with GST fields: `gstin`, `gstStateCode`, `gstRegType`, `financialYearFrom`, `booksBeginningFrom`)
  - `users.prisma`, `rbac.prisma`, `org.prisma` - users, roles/permissions, branches/departments
  - `pipeline.prisma`, `tickets.prisma`, `accounts.prisma` - ticket workflow + legacy accounts
  - `finance.prisma` - `AccountType`, `AccountGroup`, `Ledger`, `JournalEntry` (with `VOID`/`SOFT_DELETED` status), `Invoice`, voucher records, opening balances
  - `crm.prisma` - `CrmLead` (prospect → conversion to `Customer`)
  - `inbox.prisma` - `ChatRoom`, `ChatMessage`
  - `social.prisma` - `WallPost` (staff wall/profile posts)
  - `shop.prisma` - `ShopOrder`, `ShopOrderLine` (prices in integer paise; **no `ShopProduct` — merged into `InvProduct` on 2026-05-04**)
  - `inventory.prisma` - `InvUnit`, `InvCategory`, `InvProductGroup`, `InvBrand`, `InvWarrantyTerm`, `InvProduct` (now with `hsnCode`, `gstRate`, `taxability`; **single source of truth for shop + warehouse**) + voucher models (receipt/issue/transfer/adjust)
  - `portal.prisma` - `CustomerPortalCredential`
  - `enums.prisma` - shared enums (`GstRegType`, `Taxability`, …)

This supports modular ownership of schema areas while sharing one datasource.

## 7) Important Design Decisions

- Ticket workflow supports primary status + sub-status style handoffs.
- Ownership model uses a primary owner plus participant helpers.
- Pipeline model allows multiple business workflows (repair/sales/etc).
- Customer and company are separated; account is retained as legacy bridge.
- Finance follows a Tally-style mental model, normalized as `AccountType -> AccountGroup -> Ledger`.
- GST identity (GSTIN, state code, registration type) lives on `Customer` and `Company` directly — no separate `Party` model. `PartyCombobox` autofills these on voucher entry.
- HSN code and GST rate live on `InvProduct`, not per voucher line — single place to update when GST rates change.
- `InvProduct` is the single product source of truth for both shop catalog and inventory vouchers (since 2026-05-04 `ShopProduct` merge).
- Journal entries support a three-tier delete: **void** (preserves row, no GL impact), **soft-delete** (hides but retains audit), **hard-delete** (admin-only).
- Opening-balance mismatches route into a system "Suspense" ledger so trial balance always balances during legacy-book imports.
- `CrmLead` represents prospects only; conversion promotes a lead into a `Customer` row. Don't dual-write.
- Composition GST parties (`Customer.gstRegType === 'COMPOSITION'`) skip GST lines on sales vouchers regardless of the product's `gstRate`.
- Shop prices are stored as integer paise (₹1 = 100 paise) to avoid floating-point errors; use `src/shared/lib/format/moneyInr.ts` for display formatting.
- Portal and staff auth are fully separate; `CustomerPortalCredential` is not connected to the NextAuth session.
- Razorpay payment confirmation relies on the signed webhook, not the client-side payment response.
- Client-side cart/wishlist/compare state is Zustand + localStorage (no DB until checkout).

## 8) External Module Structure (`src/modules/external/`)

The external module contains all UI components for the customer-facing surface.
It is split into three sub-modules:

- `shop/` - `ShopHeader`, `ShopFooter`, `ShopSearchBar`, `ProductCard`, `AddToCartButton`, `ShopCatalogClient`, `ProductDetailTabs`, `ProductGallery`, `ProductPurchasePanel`, `ShopPageBanner`, `ShopRemoteImage`
- `store/` - `HeroCarousel`, `DealOfTheDay`, `FeaturedRow`, `BrandStrip`, `TrustStrip`, `CategoryShowcase`, `PromoBanners`
- `portal/` - `PortalHeader`
- `ExternalRootShell.tsx` - root layout shell wrapping NextAuth `SessionProvider`

All cross-boundary imports (external importing from staff-side `src/shared/`, `src/components`, etc.)
are tracked in `docs/customer-site-shared-imports.md` to make future extraction traceable.

## 9) Shared Structure (`src/shared/`)

Cross-cutting code lives under `src/shared/`. Single-module code lives under `src/modules/<m>/`.

```
src/shared/
├─ components/      cross-cutting UI (Sidebar, Topbar, PartyPicker, etc.)
├─ hooks/           cross-cutting React hooks (added in Segment 09+)
├─ types/           cross-cutting type defs (e.g., inventoryTypes.ts)
└─ lib/
   ├─ api/          (Segment 04+) validateRequest, parsePagination, prismaUniqueError, handleApiError, generateNextOpaqueId
   ├─ schemas/      Zod schema fragments (inventorySchemas.ts; commonSchemas.ts in Segment 07)
   ├─ constants/    (Segment 05+) PERMISSIONS, ACCOUNT_GROUPS
   ├─ prisma/       prismaClient.ts (Prisma singleton); fragments.ts in Segment 06
   ├─ auth/         permissions.ts, authGuard.ts, portalAuthGuard.ts, permissionScope.ts, makePermissionLayout.tsx, authorizeStaff.ts, authorizePortal.ts, portalIdentifier.ts, portalAccountContext.ts, staffEmailAllowlist.ts
   ├─ format/       formatDate.ts, timeAgo.ts, moneyInr.ts, utils.ts (cn helper)
   ├─ shop/         storeContent.ts (homepage content config), productPublic.ts (public product queries), demoReviews.ts (static UI fixtures), shopImagePlaceholder.ts (fallback image)
   ├─ portal/       mockAdapters.ts (DTO + mock data for portal pages — replace as APIs land)
   └─ supabase/     supabaseClient.ts (Supabase singleton for Realtime)
```

**Boundary rule:** code goes in `src/shared/` only if imported by two or more modules (or from `src/app/`). Single-module code lives in `src/modules/<m>/{lib,hooks,components}/`. Promote later, don't speculate.

**Naming rule:** components are `PascalCase.tsx`; hooks are `useFooBar.ts` (camelCase); utilities/schemas/constants are `camelCase.ts`; directories are `kebab-case`. See [AGENTS.md](AGENTS.md) and [docs/plans/00-segments-overview.md](docs/plans/00-segments-overview.md).

## 10) Operational Notes

- Use `pnpm`.
- After Prisma schema updates, run `prisma generate` and restart dev server.
- On Next.js 16, do not move auth middleware logic to `middleware.ts`; keep `src/proxy.ts`.
- Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` in `.env` for payment flows.

## 11) Documentation Boundaries

- Use this file for code-current architecture (including **`/office/*`** staff URLs).
- Use `PROJECT_BRAIN.md` for milestones, decisions, and roadmap.
- Use `docs/customer-site-shared-imports.md` to track cross-boundary imports from `(external)/`.
- Use `AI_HANDOFF_SUMMARY.md` as historical context from earlier iterations (file may be missing).
