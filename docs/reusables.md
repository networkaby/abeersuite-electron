# Cross-cutting reusables — DO NOT duplicate

Single source of truth for everything in `src/shared/`. Before writing a helper / hook / schema / formatter / shared component, check this index. If the symbol you need exists, use it. If you add one, register it here in the same PR (per the rule in [AGENTS.md](../AGENTS.md)).

> This index is built up segment by segment as the refactor in [docs/plans/](plans/) lands. Sections appear here only once they exist in `src/shared/`. Module-scoped reusables live in each module's own `docs/modules/<m>.md` "Reusable helpers — DO NOT duplicate" table.

## Boundary rule

Code goes in `src/shared/` only when it has importers from **two or more modules** (or from `src/app/`). Single-module code lives in `src/modules/<m>/{lib,hooks,components}/`. Promote later, don't speculate.

---

## Formatters — `src/shared/lib/format/`

| Symbol | File | Purpose |
|---|---|---|
| `formatRupees(rupees)` | `moneyInr.ts` | `1234` → `₹1,234` (no decimals; rupee input) |
| `formatRupeesFromPaise(paise)` | `moneyInr.ts` | `123400` → `₹1,234.00` (two decimals; paise input) |
| `formatDate(d)` | `formatDate.ts` | `5 Mar 2026` (en-GB, day–short-month–year) |
| `formatDateTime(d)` | `formatDate.ts` | `5 Mar 2026, 10:42` |
| `formatInboxTime(iso)` | `formatDate.ts` | Smart inbox/chat timestamp — same day → `10:42 AM`, older → `Mar 5`. Tolerates Supabase Realtime payloads missing the `Z` suffix. |
| `formatTimeOnly(iso)` | `formatDate.ts` | `10:42 AM` (en-US, time only) |
| `timeAgo(d)` | `timeAgo.ts` | `5m ago`, `2h ago`, `3d ago` |

> Avoid inline `new Intl.NumberFormat("en-IN", ...)` and inline `toLocaleTimeString(...)` for these cases — use the helpers above.

---

## Auth — `src/shared/lib/auth/`

| Symbol | File | Purpose |
|---|---|---|
| `requireAuth()` | `permissions.ts` | Staff API guard — 401 if no session, 403 if portal customer; otherwise returns the resolved user. |
| `requireRole(...roles)` | `permissions.ts` | Chains through `requireAuth` + restricts by `primaryRole` label. |
| `requirePermission(id)` | `permissions.ts` | Chains through `requireAuth` + checks the permission id (scope-aware). |
| `hasPermission(user, id)` / `isAdmin(user)` | `permissions.ts` | Predicates over a `ResolvedUser`. |
| `resolvedUserFromSession(session)` | `permissions.ts` | Build a `ResolvedUser` from a session object without enforcing any guard. Used where you've already resolved the session and just need the typed shape. |
| `ResolvedUser` (type) | `permissions.ts` | 8-field staff identity: `id, primaryRole, roles, permissions, rank, scope, departmentIds, branchIds`. |
| `requirePortalAuth()` | `portalAuthGuard.ts` | Customer portal API route guard (parallel to `requireAuth` but for portal customers). |
| `authorizeStaffCredentials` / `authorizePortalCredentials` | `authorizeStaff.ts` / `authorizePortal.ts` | NextAuth Credentials provider validators. |
| `makePermissionLayout(permissionId)` | `makePermissionLayout.tsx` | Factory for permission-gated Next.js layout wrappers. |

## Prisma — `src/shared/lib/prisma/`

| Symbol | File | Purpose |
|---|---|---|
| `prisma` | `prismaClient.ts` | Singleton `PrismaClient` instance |

## Schemas — `src/shared/lib/schemas/`

| Symbol | File | Purpose |
|---|---|---|
| (inventory CRUD schemas) | `inventorySchemas.ts` | Brand / category / unit / product create + update Zod schemas. Segment 07 will add common fragments here too. |

## Types — `src/shared/types/`

| Symbol | File | Purpose |
|---|---|---|
| `InvProductFull`, `InvProductDb`, `invProductDb` | `inventoryTypes.ts` | Typed `InvProduct` shapes used by inventory + ecommerce + shop |

## Shared UI — `src/shared/components/`

| Symbol | File | Purpose |
|---|---|---|
| `Sidebar` | `Sidebar.tsx` | Main staff-side nav |
| `Topbar` | `Topbar.tsx` | Top nav bar |
| `ButtonBar` | `ButtonBar.tsx` | Right-rail action bar shown on staff pages |
| `PartyPicker` | `PartyPicker/index.tsx` | Searchable customer/company picker with inline create |
| `QuickTicketButton` | `QuickTicketButton.tsx` | Quick ticket creation entry |
| `UniversalCreateMenu` | `UniversalCreateMenu.tsx` | Cross-module "Create new …" menu |
| `AllCreateActionsDialog` | `AllCreateActionsDialog.tsx` | Full create-actions dialog opened from `UniversalCreateMenu` |
| `OfficeModuleHub` | `OfficeModuleHub.tsx` | Module hub page shell |
| `CreatePersonDialog` / `CreateCompanyDialog` | `CreatePersonDialog.tsx` / `CreateCompanyDialog.tsx` | Modal forms for creating a person / company from anywhere |
| `UserAvatar` / `UserForm` | `UserAvatar.tsx` / `UserForm.tsx` | Avatar circle + user create/edit form |
| `ReceiptButtons` | `ReceiptButtons.tsx` | Print / PDF / share buttons on receipt pages |
| `SessionWrapper` | `SessionWrapper.tsx` | NextAuth session provider |
| `ThemeProvider` | `ThemeProvider.tsx` | next-themes provider for dark mode |

## Pipeline lookups — `src/shared/lib/format/`

Name-based resolvers for the seeded pipelines. Use these instead of hardcoding pipeline IDs (`P1`, `P6`, `P7`); IDs are opaque seed artifacts that can change.

| Symbol | File | Purpose |
|---|---|---|
| `ORDERS_PIPELINE_NAME` / `getOrdersPipeline(prisma)` / `assertOrdersStatus` | `ordersPipeline.ts` | Sales-orders pipeline (`name = "sales-orders"`). |
| `CRM_PIPELINE_NAME` / helpers | `crmPipeline.ts` | CRM-leads pipeline (`name = "crm-leads"`). |
| `REPAIR_PIPELINE_NAME` / `getRepairPipeline(prisma)` | `repairPipeline.ts` | Service & Repair pipeline (`name = "service"`). |

## Other shared lib

| Path | Purpose |
|---|---|
| `src/shared/lib/supabase/supabaseClient.ts` | Supabase singleton (used by Realtime subscribers) |
| `src/shared/lib/shop/storeContent.ts` | Storefront homepage content (hero slides, featured rows, brand list, trust points) |
| `src/shared/lib/shop/productPublic.ts` | Public product query helpers (no auth) |
| `src/shared/lib/shop/demoReviews.ts` | Static review fixtures shown in product detail tabs |
| `src/shared/lib/shop/shopImagePlaceholder.ts` | Local SVG placeholder path for failed product images |
| `src/shared/lib/portal/mockAdapters.ts` | Portal DTO types + mock data (replace as portal APIs land) |

---

## API helpers — `src/shared/lib/api/`

Import from the barrel: `import { … } from "@/shared/lib/api"`.

| Symbol | File | Purpose |
|---|---|---|
| `validateRequest(req, schema)` | `validateRequest.ts` | Parse JSON body with a Zod schema; returns `{ data, error: null }` or `{ data: null, error: NextResponse }` (400). Replaces inline `safeParse + NextResponse({ error })` boilerplate. |
| `parsePagination(searchParams, opts?)` | `parsePagination.ts` | Returns `{ take, skip, page }` from `?limit=&page=`. Bounded by `DEFAULT_PAGE_SIZE` (50) / `MAX_PAGE_SIZE` (200) unless overridden via `opts`. |
| `parseCursor(searchParams, opts?)` | `parsePagination.ts` | Returns `{ cursor, take }` from `?cursor=&limit=`. Same bounds as `parsePagination`. |
| `DEFAULT_PAGE_SIZE` / `MAX_PAGE_SIZE` | `parsePagination.ts` | Constants — use these instead of hardcoding 50 / 200 in route options. |
| `prismaUniqueError(e, message)` | `prismaUniqueError.ts` | Maps Prisma `P2002` to a 409 NextResponse. Pass a string for single-message routes, or a `Record<field, message>` to map specific columns. Returns `null` on non-P2002 errors so callers can fall through. |
| `handleApiError(e, fallback?)` | `handleApiError.ts` | Logs + returns a 500 NextResponse with the fallback message. Trailing `catch { 500 }` envelope. |
| `generateNextOpaqueId(model, prefix)` | `generateNextOpaqueId.ts` | Returns `{ id: \`${prefix}${n}\`, n }` where `n = max numeric suffix among existing IDs + 1`. Use for opaque IDs like `S50`, `SS37`, `R5`, `P1` instead of bare integers. |

> Boilerplate sweep status: opaque-ID, P2002 (simple cases), and pagination call sites are all swept (segment 04a, 17 sites). `validateRequest` (≈110 routes) and `handleApiError` (≈152 routes) sweeps are deferred to follow-up commits within this segment.

## Sections coming in later segments

The following sections will appear when their owning segment ships. See [docs/plans/](plans/) for sequencing.

- **Constants** (Segment 05) — `PERMISSIONS`, `ACCOUNT_GROUPS` in `src/shared/lib/constants/`
- **Prisma fragments** (Segment 06) — `selectPrimaryPhone`, `selectPrimaryEmail`, `selectAccountWithOwner`, `buildSearchWhere` in `src/shared/lib/prisma/fragments.ts`
- **Common Zod schemas** (Segment 07) — `labelColorSchema`, `nameDescriptionSchema`, `phoneEmailSchema`, `gstSchema`, `nameIsActiveSchema` in `src/shared/lib/schemas/commonSchemas.ts`
- **Hooks** (Segment 09) — `useComboboxNav`, `usePartySearch`, `useDeleteWithConfirm`, `useApiResource` in `src/shared/hooks/`
- **Shared UI primitives** (Segment 13) — `DataPageHeader`, `DataTableStates`, `StatusBadge` in `src/shared/components/`

Segment 16 ([16-reusables-registry.md](plans/16-reusables-registry.md)) does the final pass to ensure every symbol and importer is correctly listed and every module doc has its own "Reusable helpers — DO NOT duplicate" table.
