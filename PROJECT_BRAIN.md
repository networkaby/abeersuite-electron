# PROJECT BRAIN — ServiceMgmt

> Internal service management system for an electronics repair shop — tracking tickets, team handoffs, and customer communication across Front Desk, Technician, Despatch, and Admin roles.

**Stack:** Next.js 16.2.3 (App Router), React 19, PostgreSQL (Supabase), Prisma 7.7.0, NextAuth v5 beta (JWT), Tailwind v4, shadcn/ui, Sonner (toasts), Axios, React Hook Form, Zod, Razorpay (payments)  
**Repo:** `D:\our-own-website\service-mgmt-experiment` (local, git branch: `dev`)  
**Started:** 2026-04-17  
**Last Updated:** 2026-05-07

---

## 📌 Source of Truth

- `README.md` = setup and day-to-day runbook
- `ARCHITECTURE.md` = current implementation architecture (modules, route groups, auth/data boundaries)
- `PROJECT_BRAIN.md` = milestone history, roadmap, and decision log

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
| 19 | Tally Phase 5a — Reports hub, GST hub w/ HSN, Party CRM | ✅ Done | 2026-05-07 |

> **Current Milestone:** Milestone #20 — Tally Phase 5b (GSTR-1/3B, e-Invoice IRN, RCM) — deferred per `tally_module_status.md`; nothing actively in progress.

---

## ✅ Completed Work

### 2026-05-07 — Tally Phase 5a: Reports hub + GST hub + Party CRM (Milestones 12 + 19)

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
- **Shop lib** (`src/lib/shop/`): `store-content.ts` (homepage content config — hero slides, featured rows, brand list, trust points), `product-public.ts` (public product queries), `demo-catalog-seed.ts` (seed data helper), `demo-reviews.ts` (static review data for UI), `shop-image-placeholder.ts` (fallback image helper)
- **Portal auth lib** (`src/lib/auth/`): `authorize-portal.ts` (portal credential check + bcrypt), `portal-identifier.ts` (phone/email normalisation), `staff-email-allowlist.ts`, `authorize-staff.ts`; `src/lib/portal-auth-guard.ts` (portal-side `requirePortalAuth` guard); `src/lib/make-permission-layout.tsx` (factory for permission-gated layout wrappers); `src/lib/permission-scope.ts` + `src/lib/ticket-scope.ts`
- Files: `src/app/(external)/`, `src/modules/external/`, `prisma/schema/shop.prisma`, `prisma/schema/portal.prisma`, `src/store/external/`, `src/lib/shop/`, `src/lib/auth/`, `src/lib/portal-auth-guard.ts`, `src/app/api/shop/`, `src/app/api/portal/`, `src/app/api/upload-signature/`

### 2026-04-29 — Enterprise RBAC — Rank, Scope, Department, Branch

- **Role rank**: `rank Int` added to `Role` model (0–100); Admin=100, Manager=70, Staff=20; rank guard on `POST/PUT /api/users` prevents assigning a role equal to or above your own rank
- **UserScope enum**: `OWN | TEAM | DEPARTMENT | BRANCH | REGION | ORG` — controls how far a user's data visibility reaches
- **Branch model**: `prisma/schema/org.prisma` — id, name, address, phone, isActive; seeded with 4 sample branches (HQ, Mirpur, Chittagong, Online)
- **Department model**: `prisma/schema/org.prisma` — id, name, description, branchId (null = cross-branch); seeded with 7 departments (Repairs, Sales, Front Desk, Finance, HR, IT/Admin, Despatch)
- **User model**: added `title String?`, `scope UserScope @default(OWN)`, `departmentId`, `branchId`
- **Auth/JWT**: `rank`, `scope`, `departmentId`, `branchId`, `title` now carried in JWT and session
- **API**: `/api/branches` + `/api/departments` (full CRUD); `/api/roles` accepts `rank`; `/api/users` includes dept/branch/scope/title in responses
- **Settings UI**: `/office/branches` page (CRUD + activate/deactivate toggle); `/office/departments` page (CRUD with branch scope selector)
- **Roles settings**: rank displayed per role with inline click-to-edit; rank field in new role form
- **UserForm**: expanded with Title, Department, Branch, Scope, and role rank shown in dropdown
- **Users list**: added Department, Branch, Scope, Title columns; role shows rank badge
- **Sidebar**: Branches + Departments added under Settings nav (require `settings:manage` permission)
- **Seed**: `prisma/seed-org.ts` + SQL seed via `prisma db execute`
- Files: `prisma/schema/org.prisma`, `prisma/schema/enums.prisma`, `prisma/schema/rbac.prisma`, `prisma/schema/users.prisma`, `src/auth.ts`, `src/auth.d.ts`, `src/lib/permissions.ts`, `src/app/api/branches/`, `src/app/api/departments/`, `src/app/api/roles/`, `src/app/api/users/`, `src/app/(protected)/office/(admin)/branches/page.tsx`, `src/app/(protected)/office/(admin)/departments/page.tsx`, `src/modules/shared/components/UserForm.tsx`, `src/app/(protected)/office/(admin)/users/page.tsx`, `src/utils/constants.ts`

### 2026-04-28 — Message creation optimisation + Sentry setup
- **Messaging**: Replaced `createRoomMessage` helper with direct `prisma.chatMessage.create`; concurrent `updatedAt` write to `ChatRoom` in same operation for consistency; removed redundant `ensureCoreRooms` call on `getAccessibleRoom`
- **Sentry**: `@sentry/nextjs` version pinned to `10`; `next.config.ts` updated with org/project details, Vercel Cron Monitor auto-instrumentation, improved source-map handling; `sentry.server.config.ts` + `sentry.edge.config.ts` created; `.env.sentry-build-plugin` added to `.gitignore`
- Files: `src/app/api/inbox/rooms/[id]/messages/route.ts`, `src/lib/prisma.ts`, `src/modules/message/lib/inbox.ts`, `next.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`

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
- **Supabase Realtime**: `@supabase/supabase-js` installed via pnpm; `src/lib/supabase-client.ts` singleton; `InboxModule` subscribes to `ChatMessage INSERT` per active room — messages appear instantly across all users with no polling
- **Optimistic send**: message appears immediately with "sending…" label; Realtime replaces it with the confirmed DB record on success, rolls back on failure
- **Slack-style layout**: full-width messages, avatar + bold name + timestamp per group, consecutive messages from same sender grouped, own messages have `bg-primary/5` row tint
- **Notifications**: Web Notifications API (browser permission requested on mount) + Web Audio API "ding" sound for incoming messages from other users
- **Avatar colour fix**: own avatar = `bg-primary/20 text-primary`; others = `bg-muted text-foreground` — no more red circles for other users
- **Timestamp fix**: Supabase Realtime omits UTC 'Z' suffix — normalised before `new Date()` parse
- **Personal Inbox removed**: `PERSONAL_INBOX` rooms no longer created; filtered from all queries
- **Build fix**: `QuickTicketButton.tsx` line 669 — `technician.id` wrapped in `String()` for `SelectItem.value`
- Files: `src/modules/message/components/InboxModule.tsx`, `src/lib/supabase-client.ts`, `src/modules/message/lib/inbox.ts`, `src/app/(protected)/office/(message)/inbox/page.tsx`, `src/modules/shared/components/QuickTicketButton.tsx`, `.env`

### 2026-04-26 — Inbox UI overhaul + expandable sidebar nav
- **InboxModule rewrite**: rooms now grouped by type (System / Personal / Groups / Others) with collapsible sections; proper chat bubble layout (own messages right, others left, system centered); auto-scroll to bottom; Enter to send / Shift+Enter for newline; relative timestamps ("2m ago")
- **Sidebar Inbox section**: Inbox moved from flat WORKSPACE_NAV link to an expandable accordion — shows System / Personal / Groups sub-sections each with live unread counts fetched from `/api/inbox/rooms`; total unread badge on the Inbox header
- **Inbox page**: now passes `currentUserId` (from session) to InboxModule so own messages are aligned right; wrapped in Suspense for `useSearchParams` compatibility
- Files: `src/modules/message/components/InboxModule.tsx`, `src/modules/shared/components/Sidebar.tsx`, `src/utils/constants.ts`, `src/app/(protected)/office/(message)/inbox/page.tsx`

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
- Default post-login redirect: `/office/assignments` (staff app; was `/assignments` then `/dashboard` historically)
- Dashboard now accepts pipeline context; tickets page filtered by pipeline
- `proxy.ts` updated with redirect target
- Files: `src/app/(protected)/office/(repairing)/dashboard/page.tsx`, `src/app/(protected)/office/(repairing)/tickets/page.tsx`, `src/proxy.ts`, `src/modules/shared/components/Sidebar.tsx`

### 2026-04-24 — UniversalCreateMenu + layout
- `UniversalCreateMenu.tsx` — floating "+" menu in `ProtectedLayout` for quick access to create actions
- Sidebar dynamically fetches and displays active pipelines (server-side); pipeline switching navigation
- Files: `src/modules/shared/components/UniversalCreateMenu.tsx`, `src/app/(protected)/layout.tsx`, `src/modules/shared/components/Sidebar.tsx`

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
- Files: `src/auth.d.ts`, `src/modules/shared/components/UserForm.tsx`, `src/app/(protected)/office/(admin)/roles/page.tsx`

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
- Files: `src/app/(protected)/layout.tsx`, `src/modules/shared/components/Sidebar.tsx`, `src/app/(protected)/office/(core)/assignments/page.tsx`, `src/app/(protected)/office/(repairing)/dashboard/page.tsx`, multiple API routes

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

_(Nothing actively in progress — org RBAC system complete as of 2026-04-29)_

---

## 📋 Next Up (Prioritized)

### Tally Phase 5b — deferred (most likely to get picked up next)
1. **GSTR-1 / GSTR-3B export** — JSON download in GSTN portal format from the GST hub
2. **e-Invoice (IRN) integration** — IRP API integration on sales voucher above threshold
3. **RCM (Reverse Charge Mechanism)** handling on purchase vouchers
4. **Repair-side reporting dashboard** — tickets by status/pipeline, avg resolution time, technician workload (still missing for the repair side; finance side now covered)
5. **Ticket list pagination** — cursor-based or offset; current list loads all records

### Org RBAC — next steps
6. **Branch-scoped data filtering** — tickets, customers, invoices filtered by user's `branchId` when `scope` is BRANCH or below
7. **`settings:manage` permission** — needs to be seeded into Admin role so Branches/Departments pages are accessible
8. **Position model** — named slots in the org chart (future; needed at 50+ users)

### Shop / Portal — next steps
9. **Portal ticket detail** — customers see full ticket notes and status history, not just the list
10. **Razorpay payment status page** — post-payment redirect with real-time status polling
11. **Stock decrement on shop order confirm** — now possible since `InvProduct` is unified

### Quick UX wins
12. **U2 — duplicate Name column** in ticket list
13. **U4 — mobile grid** layout fixes
14. **U11 — toast label** improvements
15. **U16 — default date sort** on ticket list (newest first)

### Longer term
16. **SLA alerts** — flag tickets in same status too long (e.g. "Diagnosing 5+ days")
17. **Company portal** — B2B version of customer portal; companies see all linked devices/tickets
18. **ERP Module Foundation** — `AppSetting` model, static module registry, module toggle settings page (archived Phase 5)

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
- 2026-05-07 **Tally route rename**: `(tally)/finance/` → `(tally)/tally/` was deliberate to match the user-facing module label; any remaining `office/finance/...` links are now broken and should be migrated.

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
| Default post-login redirect | `/office/assignments` | `/dashboard` (historical) | Staff app lives under `/office/*`; assignments remain the primary work surface |
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
│   │       ├── (tally)/
│   │       │   └── tally/           # Was `finance/` — renamed 2026-05-07
│   │       │       ├── account-groups/ + ledgers/        # Chart of accounts hierarchy
│   │       │       ├── sales/ + purchases/ + estimates/  # Voucher entry (with PartyCombobox)
│   │       │       ├── inventory/                        # Inventory vouchers (receipt/issue/transfer/adjust)
│   │       │       ├── invoices/                         # Invoice list (filter by order source)
│   │       │       ├── journal/                          # Journal entries with three-tier delete
│   │       │       └── reports/                          # cash-book, bank-book, bank-reconciliation,
│   │       │                                             # cash-flow, fund-flow, ratio-analysis, statistics,
│   │       │                                             # receivables, payables, ledger-outstandings/[id],
│   │       │                                             # gst/ (hub) + hsn-summary, inward-supplies,
│   │       │                                             # outward-supplies, liability
│   │       ├── (social)/
│   │       │   └── users/[id]/      # Staff profile page with wall posts
│   │       ├── (admin)/
│   │       │   ├── users/           # User management + permissions modal
│   │       │   ├── branches/ + departments/ + roles/  # Org + RBAC settings
│   │       │   ├── org-chart/       # Visual org hierarchy
│   │       │   ├── posts/           # Internal notice board
│   │       │   └── role/            # Single-role matrix page
│   │       └── (e-commerce)/
│   │           └── ecommerce/       # Staff product + order management
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
│   ├── tally/                       # Finance/accounting components — BookPage, GstSummaryView, PartyCombobox
│   │   └── lib/                     # outstandings.ts, openingBalance.ts, aggregateLedger.ts
│   ├── inventory/                   # InvProductCombobox, InvProductPicker, InvVoucherForm/Detail, InvProductFormFields
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
└── proxy.ts                         # Auth middleware: `/portal/login` → `/login`; staff vs customer sign-in routing; staff post-login → `/office/assignments`
prisma/
├── schema/                          # Split Prisma schema (*.prisma by domain)
│   ├── base.prisma                  # Core CRM: Customer, Company, CustomerCompany (+ GST fields)
│   ├── users.prisma / rbac.prisma / org.prisma
│   ├── pipeline.prisma / tickets.prisma / accounts.prisma
│   ├── finance.prisma / inbox.prisma / enums.prisma  # enums: GstRegType, Taxability
│   ├── inventory.prisma             # InvProduct (unified, w/ HSN+gstRate+taxability) + voucher models
│   ├── crm.prisma                   # CrmLead model
│   ├── social.prisma                # WallPost model
│   ├── shop.prisma                  # ShopOrder, ShopOrderLine (product comes from InvProduct)
│   └── portal.prisma                # CustomerPortalCredential
├── prisma.config.ts                 # schema path + datasource + seed command
├── seed*.ts                         # seed and migration helper scripts
└── migrate-accounts.ts
```

---

## 🔗 External Resources

- **Supabase project**: PostgreSQL database (aws-1-ap-south-1.pooler.supabase.com)
- **Next.js 16 docs**: `node_modules/next/dist/docs/`
- **NextAuth v5 docs**: https://authjs.dev/
- **Prisma docs**: https://www.prisma.io/docs/
