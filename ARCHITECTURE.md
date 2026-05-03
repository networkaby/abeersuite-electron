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
- `customer` - customer/company domain components and helpers
- `message` - inbox and messaging domain
- `repairing` - ticket lifecycle, repair workflow UI/domain
- `tally` - finance and accounting features
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
- `(customer)` — customers, companies, unified “all” view
- `(message)` — inbox (`/office/inbox`)
- `(repairing)` — dashboard, tickets, service centers, repair settings (statuses, pipelines, …)
- `(social)` — staff profile pages with wall (`/office/users/[id]`)
- `(tally)` — finance (`/office/finance/...`)
- `(e-commerce)` — staff shop admin (`/office/ecommerce/...`)

Examples: `/office/tickets`, `/office/assignments`, `/office/customers`, `/office/finance/invoices`.

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
- `/api/customers/*`, `/api/companies/*`, `/api/accounts/*` - customer/company domain
- `/api/inbox/*` - room listing, read state, messages
- `/api/finance/*` - GL accounts, journal entries, invoices, reports
- `/api/call-logs/*` - inbound/outbound call record CRUD
- `/api/notifications/*` - per-user notification list + mark-read
- `/api/posts/*`, `/api/wall-posts/*` - staff notice board + user wall posts
- `/api/search-slno/*` - device serial number search
- `/api/upload-signature` - Cloudinary signed upload params
- `/api/ecommerce/*` - staff-side product and order management

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
- Customer sign-in page: **`/login`** (`src/app/(external)/login/page.tsx`); NextAuth default `pages.signIn` in `src/auth.ts` is **`/login`**. Portal credentials use `credentials-portal`; validation in `src/lib/auth/authorize-portal.ts`.
- Portal routes are guarded by `src/lib/portal-auth-guard.ts` (`requirePortalAuth`).
- Portal and staff sessions are completely independent — no crossover.

## 6) Data Model and Prisma Layout

Prisma uses split schema mode:

- `prisma.config.ts` points to `prisma/schema`
- schema files include:
  - `base.prisma` - core CRM: `Customer`, `Company`, `CustomerCompany`
  - `users.prisma`, `rbac.prisma`, `org.prisma` - users, roles/permissions, branches/departments
  - `pipeline.prisma`, `tickets.prisma`, `accounts.prisma` - ticket workflow + legacy accounts
  - `finance.prisma` - `GlAccount`, `JournalEntry`, `Invoice`
  - `inbox.prisma` - `ChatRoom`, `ChatMessage`
  - `social.prisma` - `WallPost` (staff wall/profile posts)
  - `shop.prisma` - `ShopProduct`, `ShopOrder`, `ShopOrderLine` (prices in integer paise)
  - `portal.prisma` - `CustomerPortalCredential`
  - `enums.prisma` - shared enums

This supports modular ownership of schema areas while sharing one datasource.

## 7) Important Design Decisions

- Ticket workflow supports primary status + sub-status style handoffs.
- Ownership model uses a primary owner plus participant helpers.
- Pipeline model allows multiple business workflows (repair/sales/etc).
- Customer and company are separated; account is retained as legacy bridge.
- Finance follows a Tally-style mental model, but normalized as `AccountType -> AccountGroup -> Account`.
- Shop prices are stored as integer paise (₹1 = 100 paise) to avoid floating-point errors; use `src/lib/money-inr.ts` for display formatting.
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

All cross-boundary imports (external importing from staff-side `src/lib`, `src/components`, etc.)
are tracked in `docs/customer-site-shared-imports.md` to make future extraction traceable.

## 9) Lib Structure (`src/lib/`)

- `prisma.ts` - Prisma client singleton
- `auth-guard.ts` - `requirePermission()` for staff API routes
- `portal-auth-guard.ts` - `requirePortalAuth()` for portal API routes
- `permissions.ts` - permission name constants
- `make-permission-layout.tsx` - factory for permission-gated layout wrappers
- `permission-scope.ts` - scope-aware permission helpers
- `ticket-scope.ts` - ticket visibility scoping by branch/department/scope
- `supabase-client.ts` - Supabase singleton for Realtime
- `money-inr.ts` - ₹ formatting (paise → display string)
- `format-date.ts` / `time-ago.ts` - date formatting utilities
- `auth/` - credential validation helpers:
  - `authorize-staff.ts` - staff email/password validation
  - `authorize-portal.ts` - portal bcrypt credential check
  - `portal-identifier.ts` - phone/email normalisation for portal
  - `staff-email-allowlist.ts` - allowlist for staff login
- `shop/` - shop-specific helpers:
  - `store-content.ts` - homepage content config (hero slides, featured rows, brand list)
  - `product-public.ts` - public product queries (no auth required)
  - `demo-catalog-seed.ts` - seed data helper for demo products
  - `demo-reviews.ts` - static review data for product UI
  - `shop-image-placeholder.ts` - fallback image helper

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
