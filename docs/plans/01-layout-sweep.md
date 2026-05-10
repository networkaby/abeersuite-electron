# Segment 01 — Layout sweep

## Goal

Promote `src/lib/` → `src/shared/lib/*` (sub-bucketed) and `src/modules/shared/components/` → `src/shared/components/`. Convert all moved `.ts` files from kebab-case to camelCase as part of the sweep, to align with React + JS conventions. One mechanical PR; no logic changes.

## Why this is segment 01

Every later segment writes new code into `src/shared/`. Doing the layout sweep first means no file gets touched twice.

## Target structure

```
src/shared/
├─ components/      (moved from src/modules/shared/components/)
├─ lib/
│  ├─ api/          (empty for now; Segment 04 fills)
│  ├─ schemas/      (empty for now; Segment 07 fills)
│  ├─ constants/    (empty for now; Segment 05 fills)
│  ├─ prisma/       prismaClient.ts (was src/lib/prisma.ts)
│  ├─ auth/         permissions.ts, authGuard.ts, portalAuthGuard.ts, makePermissionLayout.tsx, permissionScope.ts
│  └─ format/       formatDate.ts, timeAgo.ts, moneyInr.ts, utils.ts
└─ types/           (empty for now)
```

`src/lib/` and `src/modules/shared/` are removed at end of this PR.

## Mapping (kebab-case → camelCase, `src/lib/*` → `src/shared/lib/<bucket>/*`)

| Old path | New path |
|---|---|
| `src/lib/prisma.ts` | `src/shared/lib/prisma/prismaClient.ts` |
| `src/lib/permissions.ts` | `src/shared/lib/auth/permissions.ts` |
| `src/lib/permission-scope.ts` | `src/shared/lib/auth/permissionScope.ts` |
| `src/lib/auth-guard.ts` | `src/shared/lib/auth/authGuard.ts` |
| `src/lib/portal-auth-guard.ts` | `src/shared/lib/auth/portalAuthGuard.ts` |
| `src/lib/make-permission-layout.tsx` | `src/shared/lib/auth/makePermissionLayout.tsx` |
| `src/lib/format-date.ts` | `src/shared/lib/format/formatDate.ts` |
| `src/lib/time-ago.ts` | `src/shared/lib/format/timeAgo.ts` |
| `src/lib/money-inr.ts` | `src/shared/lib/format/moneyInr.ts` |
| `src/lib/utils.ts` | `src/shared/lib/format/utils.ts` |
| `src/lib/crm-pipeline.ts` | `src/shared/lib/format/crmPipeline.ts` ⚠️ moved into module in Segment 08 |
| `src/lib/ticket-scope.ts` | `src/shared/lib/format/ticketScope.ts` ⚠️ moved into module in Segment 08 |
| `src/lib/post-invoice-je.ts` | `src/shared/lib/format/postInvoiceJe.ts` ⚠️ moved into module in Segment 08 |
| `src/lib/orders-pipeline.ts` | `src/shared/lib/format/ordersPipeline.ts` ⚠️ moved into module in Segment 08 |
| `src/lib/company-contacts.ts` | `src/shared/lib/format/companyContacts.ts` ⚠️ moved into module in Segment 08 |
| `src/lib/contact-write.ts` | `src/shared/lib/format/contactWrite.ts` ⚠️ moved into module in Segment 08 |
| `src/lib/inventory/schemas.ts` | `src/shared/lib/schemas/inventorySchemas.ts` ⚠️ revisited in Segment 07 |
| `src/lib/inventory/types.ts` | `src/shared/types/inventoryTypes.ts` |
| (any other `src/lib/*`) | `src/shared/lib/<best-fit-bucket>/<camelCase>.ts` |

> The "domain" files (crmPipeline, ticketScope, etc.) move twice — once here (mechanical), again in Segment 08 (into their owning modules). This avoids touching them three times.

## `src/modules/shared/components/` → `src/shared/components/`

Move the 15 component files **as-is** (already PascalCase) — only their import paths change.

| Old | New |
|---|---|
| `src/modules/shared/components/Sidebar.tsx` | `src/shared/components/Sidebar.tsx` |
| `src/modules/shared/components/Topbar.tsx` | `src/shared/components/Topbar.tsx` |
| `src/modules/shared/components/PartyPicker/index.tsx` | `src/shared/components/PartyPicker/index.tsx` |
| ...etc. for the other 12 | ... |

After move, delete `src/modules/shared/`.

## Step-by-step

1. Create `src/shared/{components,hooks,lib/{api,schemas,constants,prisma,auth,format},types}/`.
2. `git mv` each file per the table above (preserves git history).
3. Rename inside `git mv` from kebab-case to camelCase for `.ts` files.
4. Sweep imports across the whole repo:
   - `@/lib/prisma` → `@/shared/lib/prisma/prismaClient`
   - `@/lib/permissions` → `@/shared/lib/auth/permissions`
   - `@/lib/auth-guard` → `@/shared/lib/auth/authGuard`
   - `@/lib/format-date` → `@/shared/lib/format/formatDate`
   - `@/lib/money-inr` → `@/shared/lib/format/moneyInr`
   - `@/lib/time-ago` → `@/shared/lib/format/timeAgo`
   - `@/lib/utils` → `@/shared/lib/format/utils`
   - `@/lib/permission-scope` → `@/shared/lib/auth/permissionScope`
   - `@/lib/portal-auth-guard` → `@/shared/lib/auth/portalAuthGuard`
   - `@/lib/make-permission-layout` → `@/shared/lib/auth/makePermissionLayout`
   - `@/lib/crm-pipeline` → `@/shared/lib/format/crmPipeline` (will move again in 08)
   - (all other domain files similarly)
   - `@/modules/shared/components/X` → `@/shared/components/X`
5. Delete empty `src/lib/` and `src/modules/shared/` directories.
6. `npx tsc --noEmit` — fix any leftovers.
7. `npm run build` — clean.

## Verification

- [ ] `src/lib/` does not exist
- [ ] `src/modules/shared/` does not exist
- [ ] `src/shared/lib/{api,schemas,constants,prisma,auth,format}/` exist
- [ ] `tsc --noEmit` clean
- [ ] `npm run build` clean
- [ ] Browser smoke: login, voucher form, POS, list page

## Rollback

`git revert` the merge commit. No data, no schema, no env changes — purely structural.

## Out of scope

- Moving domain helpers (crmPipeline etc.) into their owning modules → **Segment 08**.
- Adding new files (api helpers, hooks, constants) → later segments.
- Renaming module-internal kebab-case files (e.g., inside `accountancy/lib/`) — done case-by-case in Segment 10 if at all.

---

## Post-execution notes (what actually happened, 2026-05-10)

Status: **complete** — `tsc --noEmit` clean, `npm run build` clean, dev server serves 200s, page snapshot shows full render.

Divergences from the plan above:

1. **Three buckets added** that were not in the original plan, because the audit before writing the plan missed several `src/lib/` sub-folders:
   - `src/shared/lib/shop/` — five files (`storeContent.ts`, `productPublic.ts`, `demoReviews.ts`, `shopImagePlaceholder.ts`, plus the seed fixture, see #2)
   - `src/shared/lib/portal/` — `mockAdapters.ts` (DTO + mock data for portal pages)
   - `src/shared/lib/supabase/` — `supabaseClient.ts`
2. **Demo seed fixture moved out of `src/shared/`** (follow-up): `demoCatalogSeed.ts` was first parked in `src/shared/lib/shop/` (mechanical) and then moved to `prisma/seeds/data/demoCatalogSeed.ts` after the user flagged that it's dev-only fixture data, not runtime code.
3. **Total files moved**: 30 lib files + 15 component files + 1 follow-up seed move = **46 file moves**. All `git mv` to preserve history.
4. **Total imports swept**: 562 occurrences across 310 files (sed across `src/`).
5. **Config files updated manually** (sed didn't touch them):
   - `components.json` — shadcn aliases (`utils`, `lib`, `hooks`)
   - `eslint.config.mjs` — three `@/modules/shared/components/...` paths
   - `prisma/seeds/dummy-shop.ts` — relative `../../src/lib/...` imports
   - `prisma/smoke-test-people.ts` — dynamic `import()` with relative path
6. **Dead `prisma.seed` block removed from `package.json`** (follow-up): the `"prisma": { "seed": "tsx prisma/seeds/baseline.ts" }` block referenced a file that didn't exist; the real production seed runs through `prisma.config.ts → migrations.seed = bootstrap-seed.ts`.
7. **Docs updated** in the same commit:
   - `docs/seeds.md` — full rewrite for current single-bootstrap reality
   - `AGENTS.md` — added the seeds-sync rule **and** the "after every plan / segment completes — update three things" rule
   - `ARCHITECTURE.md` § 9 — rewritten to describe `src/shared/` layout
   - `PROJECT_BRAIN.md`, `README.md`, `docs/modules/README.md` template — old `src/lib/` paths swept

The original plan's "Mapping" table is preserved above as historical record. The actual final layout matches the [00-segments-overview.md](00-segments-overview.md) target tree.
