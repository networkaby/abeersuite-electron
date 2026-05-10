# Segment 16 — Reusables registry

## Goal

Create a single source of truth for **all** reusables (shared lib + shared hooks + shared components) and add an enforcement rule to `AGENTS.md`. This is the mechanism that **stops duplication from coming back** after the previous 15 segments fix it.

## Files created

- `docs/reusables.md` — top-level index of every cross-cutting helper, hook, schema, formatter, component.

## Files modified

- `docs/modules/admin.md`
- `docs/modules/customer.md` (or `people.md` if not yet renamed)
- `docs/modules/repairing.md` (or `repair.md`)
- `docs/modules/ecommerce.md` (or `sales.md`)
- `docs/modules/messaging.md`
- `docs/modules/customer-portal.md`
- `docs/modules/core.md` (created in Segment 15)
- `docs/modules/pos.md` (created in Segment 15)

  → each gets a "Reusable helpers — DO NOT duplicate" table.

- `docs/modules/accountancy.md` and `docs/modules/inventory.md` — already have the table; expand with new entries from Segments 04, 06, 08, 09.

- `AGENTS.md` — add the registry-check rule and the boundary rule.

## `docs/reusables.md` structure

```markdown
# Cross-cutting reusables — DO NOT duplicate

Before writing a new helper / hook / schema / formatter / shared component, check this index. If the symbol you need exists, use it. If you add one, register it here in the same PR.

## API helpers — `src/shared/lib/api/`

| Symbol | File | Purpose |
|--------|------|---------|
| `validateRequest` | `validateRequest.ts` | Parse body with Zod; return 400 NextResponse on failure. |
| `parsePagination` | `parsePagination.ts` | `take/skip/page` from URLSearchParams. |
| `parseCursor` | `parsePagination.ts` | Cursor-mode pagination params. |
| `prismaUniqueError` | `prismaUniqueError.ts` | Map P2002 to 409 NextResponse. |
| `handleApiError` | `handleApiError.ts` | Catch-all 500 envelope with logging. |
| `generateNextOpaqueId` | `generateNextOpaqueId.ts` | `${prefix}${maxN+1}` for opaque IDs. |

## Schemas — `src/shared/lib/schemas/`

| Symbol | File | Used by |
|---|---|---|
| `labelColorSchema` | `commonSchemas.ts` | ticket-statuses, sub-statuses, roles, pipelines |
| `nameDescriptionSchema` | `commonSchemas.ts` | gl-accounts, ledgers, departments |
| `phoneEmailSchema` | `commonSchemas.ts` | people, companies, leads, orders, service-centers |
| `gstSchema` | `commonSchemas.ts` | people, companies |
| `nameIsActiveSchema` | `commonSchemas.ts` | inventory categories, brands, units, coupons |

## Constants — `src/shared/lib/constants/`

| Symbol | File | Source of truth |
|---|---|---|
| `PERMISSIONS` | `permissions.ts` | seeded from `prisma/seeds/new-seed.ts` |
| `ACCOUNT_GROUPS` | `accounting.ts` | seeded |

## Prisma fragments — `src/shared/lib/prisma/`

| Symbol | File | Purpose |
|---|---|---|
| `selectPrimaryPhone` | `fragments.ts` | `phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1 }` |
| `selectPrimaryEmail` | `fragments.ts` | same for emails |
| `selectAccountWithOwner` | `fragments.ts` | account + person/company + primary phone |
| `buildSearchWhere` | `fragments.ts` | OR-search across name/phone/email/gstin |

## Hooks — `src/shared/hooks/`

| Symbol | File | Purpose |
|---|---|---|
| `useComboboxNav` | `useComboboxNav.ts` | Generic dropdown keyboard nav |
| `usePartySearch` | `usePartySearch.ts` | Debounced `/api/people?lookup=` |
| `useDeleteWithConfirm` | `useDeleteWithConfirm.ts` | Confirm + DELETE + toast |
| `useApiResource` | `useApiResource.ts` | GET + loading + error |

## Formatters — `src/shared/lib/format/`

| Symbol | File | Purpose |
|---|---|---|
| `formatRupees` | `moneyInr.ts` | `1234` → `₹1,234` |
| `formatRupeesFromPaise` | `moneyInr.ts` | `123400` → `₹1,234.00` |
| `formatDate` | `formatDate.ts` | `5 Mar 2026` |
| `formatDateTime` | `formatDate.ts` | `5 Mar 2026, 10:42` |
| `formatInboxTime` | `formatDate.ts` | smart inbox timestamps |
| `formatTimeOnly` | `formatDate.ts` | `10:42 AM` |
| `timeAgo` | `timeAgo.ts` | `5m ago`, `2h ago` |

## Auth — `src/shared/lib/auth/`

| Symbol | File | Purpose |
|---|---|---|
| `requireAuth` | `permissions.ts` | gate; returns `{ user, response }` |
| `requirePermission` | `permissions.ts` | gate by permission ID |
| `requireRole` | `permissions.ts` | gate by primaryRole |
| `hasPermission` | `permissions.ts` | predicate |
| `isAdmin` | `permissions.ts` | predicate |
| `resolvedUserFromSession` | `permissions.ts` | helper |

## Shared UI — `src/shared/components/`

| Symbol | File | Purpose |
|---|---|---|
| `Sidebar` | `Sidebar.tsx` | main nav |
| `Topbar` | `Topbar.tsx` | top nav |
| `PartyPicker` | `PartyPicker/index.tsx` | searchable party picker with inline create |
| `DataPageHeader` | `DataPageHeader.tsx` | title + subtitle + actions |
| `DataTableStates` | `DataTableStates.tsx` | `TableLoadingRow`, `TableEmptyRow`, `TableErrorRow` |
| `StatusBadge` | `StatusBadge.tsx` | colored status pill |
| `QuickTicketButton` | `QuickTicketButton.tsx` | quick ticket creation |
| (etc — full list) | | |

## Module-scoped reusables

For helpers used inside one module only, see the "Reusable helpers — DO NOT duplicate" table in:
- [docs/modules/accountancy.md](modules/accountancy.md)
- [docs/modules/admin.md](modules/admin.md)
- [docs/modules/customer.md](modules/customer.md)
- [docs/modules/ecommerce.md](modules/ecommerce.md)
- [docs/modules/inventory.md](modules/inventory.md)
- [docs/modules/messaging.md](modules/messaging.md)
- [docs/modules/repairing.md](modules/repairing.md)

## Boundary rule

A helper goes in `src/shared/` only if it has importers from **two or more modules** (or from `src/app/`). Single-module helpers live in `src/modules/<m>/{lib,hooks,components}/`. When in doubt, start in the module — promote later.
```

## `AGENTS.md` additions

```markdown
# Reusables registry

Before adding a helper / hook / schema / formatter / shared component, check `docs/reusables.md` and the relevant `docs/modules/<m>.md` "Reusable helpers" table. If you add one, register it there in the same PR.

# Boundary rule

`src/shared/` is for code with two-or-more-module importers. Single-module code lives in `src/modules/<m>/`. Promote later, don't speculate.
```

## Per-module table additions (templates)

For each module doc, add a section like:

```markdown
## Reusable helpers — DO NOT duplicate

| Symbol | File | Purpose |
|--------|------|---------|
| `crmPipeline` | `src/modules/customer/lib/crmPipeline.ts` | CRM pipeline state machine |
| `companyContacts` | `src/modules/customer/lib/companyContacts.ts` | Contact merge/dedupe |
| `contactWrite` | `src/modules/customer/lib/contactWrite.ts` | Contact create/update transaction |
| `CustomersListPage` | `src/modules/customer/components/CustomersListPage.tsx` | All-customers list page |
```

(Match each module's actual exports. After Segments 08, 11, 12, the lists are deterministic.)

## Step-by-step

1. Write `docs/reusables.md` from the template above.
2. Update `AGENTS.md`.
3. Walk each `docs/modules/<m>.md`, add or expand the reusables table to match the module's actual exports after Segments 08, 11, 12.
4. Cross-link: every reusable in `docs/reusables.md` links to its file; every module table link is reciprocal.

## Verification

- [ ] `docs/reusables.md` exists and covers every export under `src/shared/`
- [ ] Every `src/shared/<area>/<file>` is referenced in `docs/reusables.md`
- [ ] Every `docs/modules/<m>.md` has a reusables table
- [ ] `AGENTS.md` has the registry rule and boundary rule
- [ ] Docs render correctly (links resolve)

## Why this is the last segment

All previous 15 segments produce a clean state. This segment is the **enforcement layer** — the rule that keeps it clean. Without it, the duplication grows back. With it, future contributors (human or agent) check the registry first, find the helper, use it. Adding a new one means registering it. No registry entry → reviewers reject.
