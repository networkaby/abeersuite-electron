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
| `cn(...inputs)` | `utils.ts` | shadcn's `clsx + tailwind-merge` className combiner — use everywhere conditional Tailwind class lists appear. |

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
| `hasPermissionWithScope(perms, id)` | `permissionScope.ts` | Scope-aware predicate used internally by `hasPermission`. Rarely needed at call sites. |
| `isStaffEmailDomainAllowed(email)` | `staffEmailAllowlist.ts` | Validate that an email belongs to one of the staff-allowed domains. |
| `getPortalAccountContext()` | `portalAccountContext.ts` | Resolve the active portal customer's account context inside portal routes. |
| `normalizePortalIdentifier(input)` | `portalIdentifier.ts` | Phone/email normalisation for portal credential lookup. |

## Prisma — `src/shared/lib/prisma/`

| Symbol | File | Purpose |
|---|---|---|
| `prisma` | `prismaClient.ts` | Singleton `PrismaClient` instance |
| `selectPrimaryPhone` | `fragments.ts` | `{ orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1 }` — drop into `include.phones` / `select.phones` blocks. |
| `selectPrimaryEmail` | `fragments.ts` | Same shape for the `Email` model. Use in `include.emails` / `select.emails`. |

## Schemas — `src/shared/lib/schemas/`

| Symbol | File | Purpose |
|---|---|---|
| `labelColorSchema` | `commonSchemas.ts` | `{ label: required, color: optional }` — ticket-statuses, sub-statuses, and other settings rows that carry a Tailwind color-class string. Routes whose `color` is required (e.g. roles) keep their inline schema. |
| `phoneEmailSchema` | `commonSchemas.ts` | `{ phones: string[], emails: string[] }` defaulting to `[]`. Multi-value contact arrays for people / companies / service rows. |
| `gstSchema` | `commonSchemas.ts` | `{ gstin, gstStateCode, gstRegType }` — Indian GSTIN trio. All three optional with empty-string tolerance. |
| `nameIsActiveSchema` | `commonSchemas.ts` | `{ name: required (≤ 200), isActive: optional default true }` — simple inventory master entities (brands, categories, product groups, warranty terms). |
| (inventory CRUD schemas) | `inventorySchemas.ts` | Brand / category / unit / product / warranty-term schemas. `invCategory*`, `invBrand*`, `invProductGroup*`, `invWarrantyTerm*` now `extend()` `nameIsActiveSchema`. |

> Compose with `.extend({...})` or `.partial()` rather than re-declaring the base fields. Routes whose constraints differ (custom max length, regex, required-vs-optional) keep their inline schema — DRY doesn't justify a wider base that everyone has to override.

## Types — `src/shared/types/`

| Symbol | File | Purpose |
|---|---|---|
| `InvProductFull`, `InvProductDb`, `invProductDb` | `inventoryTypes.ts` | Typed `InvProduct` shapes used by inventory + ecommerce + shop |

## Shared UI — `src/shared/components/`

| Symbol | File | Purpose |
|---|---|---|
| `Sidebar` | `Sidebar.tsx` | Main staff-side nav |
| `Topbar` | `Topbar.tsx` | Top nav bar |
| `DataPageHeader` | `DataPageHeader.tsx` | Standard list/detail page header — title + optional subtitle + icon + right-aligned actions slot. |
| `TableLoadingRow`, `TableEmptyRow`, `TableErrorRow` | `DataTableStates.tsx` | Drop-in shadcn `<TableRow>` states for the three common conditions — replaces inline `<TableRow><TableCell colSpan={N}>Loading…</TableCell></TableRow>` blocks. |
| `StatusBadge` | `StatusBadge.tsx` | Coloured pill that resolves Tailwind classes from `INVOICE_STATUS_COLORS` / `JOURNAL_STATUS_COLORS` / `GL_TYPE_COLORS` based on a `kind` discriminator. |
| `ButtonBar` | `ButtonBar.tsx` | Right-rail action bar shown on staff pages |
| `PartyPicker` | `PartyPicker/index.tsx` | Searchable customer/company picker with inline create |
| `QuickTicketButton` | `QuickTicketButton.tsx` | Quick ticket creation entry |
| `PartySearchAndCreate`, `PickedParty`, `PartySearchAndCreateHandle` | `PartySearchAndCreate.tsx` | Shared "search party or create party" surface used by POS + Quick Ticket. Includes keyboard-first lookup (`/api/people?lookup=`), inline Person/Company create dialog, and imperative helpers (`focus`, `clear`, `openNew`). |
| `UniversalCreateMenu` | `UniversalCreateMenu.tsx` | Cross-module "Create new …" menu |
| `AllCreateActionsDialog` | `AllCreateActionsDialog.tsx` | Full create-actions dialog opened from `UniversalCreateMenu` |
| `OfficeModuleHub` | `OfficeModuleHub.tsx` | Module hub page shell |
| `CreatePersonDialog` / `CreateCompanyDialog` | `CreatePersonDialog.tsx` / `CreateCompanyDialog.tsx` | Modal forms for creating a person / company from anywhere |
| `UserAvatar` / `UserForm` | `UserAvatar.tsx` / `UserForm.tsx` | Avatar circle + user create/edit form |
| `ReceiptButtons` | `ReceiptButtons.tsx` | Print / PDF / share buttons on receipt pages |
| `SessionWrapper` | `SessionWrapper.tsx` | NextAuth session provider |
| `ThemeProvider` | `ThemeProvider.tsx` | next-themes provider for dark mode |

## Module-scoped helpers (NOT in `src/shared/`)

The following used to live in `src/shared/lib/format/` but have been promoted to their owning modules (Segment 08). Each is consumed by routes + components within a single module domain — don't import them across module boundaries; talk to the module via its API instead.

| Symbol | File | Domain |
|---|---|---|
| `getOrdersPipeline`, `ORDERS_PIPELINE_NAME`, `assertOrdersStatus` | `src/modules/ecommerce/lib/ordersPipeline.ts` | ecommerce |
| `getCrmPipeline`, `CRM_PIPELINE_NAME`, `assertCrmStatus` | `src/modules/customer/lib/crmPipeline.ts` | customer |
| `getRepairPipeline`, `REPAIR_PIPELINE_NAME` | `src/modules/repairing/lib/repairPipeline.ts` | repairing |
| `getCompanyContacts` | `src/modules/customer/lib/companyContacts.ts` | customer |
| `ContactConflictError`, `contactValueSchema`, `updatePhone`, `updateEmail`, etc. | `src/modules/customer/lib/contactWrite.ts` | customer |
| `buildTicketReadScopeWhere` | `src/modules/repairing/lib/ticketScope.ts` | repairing |
| `postInvoiceJe` | `src/modules/accountancy/lib/postInvoiceJe.ts` | accountancy |

## Hooks — `src/shared/hooks/`

Import from the barrel: `import { … } from "@/shared/hooks"`.

| Symbol | File | Purpose |
|---|---|---|
| `useComboboxNav({ count, onSelect, onClear?, blurDelayMs? })` | `useComboboxNav.ts` | Generic dropdown keyboard nav — owns `open`, `highlighted`, `dropdownWidth`, wrapper/list/input refs, plus `handleKeyDown` (ArrowUp/Down/Enter/Escape), `handleBlur` (150 ms close delay), and `clear`. Consumers handle their own Tab behaviour. Auto-resets `highlighted` to 0 when `count` changes. |
| `usePartySearch(query, opts?)` | `usePartySearch.ts` | Debounced lookup against `/api/people?lookup=…`. Returns `{ hits: PartyHit[], loading }`. Empty/whitespace queries short-circuit; aborts and clears on unmount. Default debounce 200 ms. |
| `useDeleteWithConfirm({ url, message?, successMessage?, errorMessage?, onSuccess? })` | `useDeleteWithConfirm.ts` | Replaces the inline `confirm() + axios.delete + toast` boilerplate. Returns `{ remove(id, item?), deleting }`. |
| `useApiResource<T>(url, opts?)` | `useApiResource.ts` | One-shot GET hook for `useEffect(() => fetch().then(setState))`. Returns `{ data, loading, error, reload }`. Pass `null` to disable. |
| `PartyHit` (type) | `usePartySearch.ts` | The result-row shape returned by `/api/people?lookup=`. |

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

> Boilerplate sweep status (post-Segment 04): opaque-ID (3), P2002 simple cases (8), pagination (6), validateRequest (107 of 110), and handleApiError (162 of ~167) all swept. Residuals are deliberate inline cases (richer error shapes, non-catch 500s, etc.) — see segment 04 post-execution notes.

## Constants — `src/shared/lib/constants/`

| Symbol | File | Purpose |
|---|---|---|
| `PERMISSIONS` | `permissions.ts` | Typed permission-id object — `PERMISSIONS.SETTINGS_MANAGE` etc. Mirrors `prisma/seeds/bootstrap-seed.ts`. Pass to `requirePermission(id)`, `hasPermission(user, id)`, `makePermissionLayout(id)`, `user.permissions.includes(id)`. |
| `PermissionId` (type) | `permissions.ts` | Union of all `PERMISSIONS` values — use in helper signatures that accept a permission id. |
| `ACCOUNT_GROUPS` | `accounting.ts` | `{ SUNDRY_DEBTORS: "Sundry Debtors", SUNDRY_CREDITORS: "Sundry Creditors" }` — the two `AccountGroup.name` literals matched in journal posting, party-ledger creation, and receivables/payables reports. |
| `AccountGroupName` (type) | `accounting.ts` | Union of `ACCOUNT_GROUPS` values. |

> Use these instead of bare string literals so TypeScript catches typos and renames are a single-file change.

## Module-scoped reusables — see each module's doc

Helpers used by only **one** module live inside that module and are documented in its `docs/modules/<m>.md` "Reusable helpers — DO NOT duplicate" table. Check there before adding new helpers to a module:

- [accountancy.md](modules/accountancy.md) — `aggregateLedger`, `effectiveBalance`, `loadGroupRolledUpBalances`, `closingStock`, `netProfitLoss`, `voucherLifecycle`, `postInvVoucher`, `postInvoiceJe`, `refResolver`, `seedVoucherSeries`, …
- [inventory.md](modules/inventory.md) — `stock` / `stockValue` helpers (`productOpeningValue`, `productClosingValue`, `calcLineTotals`, `calcVoucherTotals`, …)
- [people.md](modules/people.md) — `crmPipeline`, `companyContacts`, `contactWrite`
- [repair.md](modules/repair.md) — `ticketScope`, `repairPipeline`
- [sales.md](modules/sales.md) — `ordersPipeline`, `orderStatus`, `orderStatusTransitions`, `productAdmin`
- [messaging.md](modules/messaging.md) — `inbox` (room/membership/unread helpers)

Module-scoped means: **import only from inside that module**. Cross-module callers should use the API surface (route handlers), not reach into another module's `lib/`.
