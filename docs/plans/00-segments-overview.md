# Segments overview

This directory holds the implementation plan for **modular reorganization + DRY consolidation + reusables registry**, split into 16 reviewable segments. Each segment is one PR.

## Sequencing rules

1. Segments must merge **in numerical order** — each one establishes patterns the next relies on.
2. After every segment: `npx tsc --noEmit` and `npm run build` must be clean before merging.
3. After segments touching API routes: smoke-test affected endpoints.
4. After segments touching UI: spot-check voucher form, POS, inventory list, login, a permission-gated route.
5. **PosScreen UX is byte-identical across every segment.** Snapshot panel, "New customer" dialog, cart, payment splits, Ctrl+Enter checkout — all unchanged.

## Conventions enforced

| Convention | Rule | Examples |
|------------|------|----------|
| Path alias | `@/` = `src/` only | `@/shared/lib/format/formatDate` |
| Components | **PascalCase** `.tsx` | `PartyPicker.tsx` |
| Hooks | **camelCase** `.ts` | `useComboboxNav.ts` |
| Utilities / lib / schemas / constants | **camelCase** `.ts` | `formatDate.ts`, `commonSchemas.ts` |
| Directories | **kebab-case** | `src/shared/lib/`, `accountancy/components/` |
| Exports | named exports preferred; `default` only for `page.tsx`/`layout.tsx` | — |

## Index

| # | File | Title | Risk |
|---|---|---|---|
| 01 | [01-layout-sweep.md](01-layout-sweep.md) | Promote `src/lib/` → `src/shared/lib/*`; promote `src/modules/shared/` → `src/shared/` | Low |
| 02 | [02-utility-quick-wins.md](02-utility-quick-wins.md) | Add `formatRupees`, `formatInboxTime`, `formatTimeOnly` | Low |
| 03 | [03-auth-consolidation.md](03-auth-consolidation.md) | Merge `authGuard` into `permissions` | Medium |
| 04 | [04-api-helpers.md](04-api-helpers.md) | `validateRequest`, `parsePagination`, `prismaUniqueError`, `handleApiError`, `generateNextOpaqueId` | Low |
| 05 | [05-constants.md](05-constants.md) | `PERMISSIONS`, `ACCOUNT_GROUPS` | Low |
| 06 | [06-prisma-fragments.md](06-prisma-fragments.md) | `selectPrimaryPhone`, `selectAccountWithOwner`, `buildSearchWhere` | Low |
| 07 | [07-zod-schemas.md](07-zod-schemas.md) | `labelColorSchema`, `phoneEmailSchema`, etc. | Low |
| 08 | [08-domain-helpers-into-modules.md](08-domain-helpers-into-modules.md) | Move 6 domain helpers into modules | Low |
| 09 | [09-shared-hooks.md](09-shared-hooks.md) | `useComboboxNav`, `usePartySearch`, `useDeleteWithConfirm`, `useApiResource` | Medium |
| 10 | [10-module-folder-standardisation.md](10-module-folder-standardisation.md) | Add missing `lib/` / `hooks/` per module | Low |
| 11 | [11-page-extraction-monsters.md](11-page-extraction-monsters.md) | Extract 6 pages > 500 lines into module components | Medium |
| 12 | [12-page-extraction-medium.md](12-page-extraction-medium.md) | Extract 11 pages 250–500 lines | Medium |
| 13 | [13-shared-ui-primitives.md](13-shared-ui-primitives.md) | `DataPageHeader`, `DataTableStates`, `StatusBadge` | Medium |
| 14 | [14-api-path-rename.md](14-api-path-rename.md) | `/api/finance/*` → `/api/accountancy/*` shim | Medium |
| 15 | [15-docs-cleanup.md](15-docs-cleanup.md) | Delete `tally.md`; add `core.md`, `pos.md` | None |
| 16 | [16-reusables-registry.md](16-reusables-registry.md) | `docs/reusables.md` + per-module tables + AGENTS.md rule | None |

## Target layout (after segment 16)

```
src/
├─ app/                   Next.js routes (thin server wrappers)
├─ components/ui/         shadcn primitives (UNTOUCHED)
├─ shared/                cross-cutting; non-feature, non-app
│  ├─ components/
│  ├─ hooks/
│  ├─ lib/{api,schemas,constants,prisma,auth,format}/
│  └─ types/
├─ modules/<m>/{components,lib,hooks}/
└─ store/                 Zustand stores
```

## Definition of done (whole programme)

- No file in `src/` violates the conventions table.
- `src/lib/` and `src/modules/shared/` no longer exist.
- Every helper, hook, schema, formatter is registered in `docs/reusables.md` or a per-module reusables table.
- `AGENTS.md` includes the registry-check rule.
- All 17 heavy pages are <50-line server wrappers; logic lives in `modules/<m>/components/`.
- `/api/finance/*` is removed (or kept only as deprecated shim, depending on rollout).
