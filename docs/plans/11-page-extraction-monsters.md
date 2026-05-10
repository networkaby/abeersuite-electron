# Segment 11 — Page extraction (monsters > 500 lines)

## Goal

Extract the six largest `"use client"` page files (559–1161 lines) into module components. Each `app/.../page.tsx` becomes a ~30-line server wrapper handling auth + initial render only.

This segment **establishes the pattern** that Segment 12 will repeat for the 11 medium pages.

## Pages

| # | Source page | Lines | Move to | Notes |
|---|---|---|---|---|
| 1 | `src/app/(protected)/office/(admin)/role/page.tsx` | 1161 | `src/modules/admin/components/RoleMatrixPage.tsx` | Extract permission grid logic into `src/modules/admin/lib/permissionMatrix.ts` if separable |
| 2 | `src/app/(protected)/office/(admin)/sub-statuses/page.tsx` | 847 | `src/modules/repairing/components/SubStatusManagerPage.tsx` | Extract transition graph helpers into `src/modules/repairing/lib/subStatusGraph.ts` if separable |
| 3 | `src/app/(protected)/office/accountancy/opening-balance/page.tsx` | 787 | `src/modules/accountancy/components/OpeningBalanceImportPage.tsx` | CSV parsing + suspense logic stay inline (single use) |
| 4 | `src/app/(protected)/office/(admin)/statuses/page.tsx` | 620 | `src/modules/repairing/components/StatusManagerPage.tsx` | — |
| 5 | `src/app/(protected)/office/(admin)/posts/page.tsx` | 589 | `src/modules/admin/components/PostsManagerPage.tsx` | — |
| 6 | `src/app/(protected)/office/(admin)/year-ending/page.tsx` | 559 | `src/modules/accountancy/components/YearEndingPage.tsx` | Closing-stock calc may already exist in `accountancy/lib/closingStock.ts` — reuse, don't duplicate |

## Pattern (apply to each)

### Before
```ts
// app/(protected)/office/(admin)/users/page.tsx — 320 lines, "use client"
"use client";
import { ... };
export default function UsersPage() {
  const [users, setUsers] = useState(...);
  // ... 300 lines of state, handlers, JSX
}
```

### After
```ts
// app/(protected)/office/(admin)/role/page.tsx — ~30 lines, server
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { RoleMatrixPage } from "@/modules/admin/components/RoleMatrixPage";

export default async function Page() {
  const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
  if (response) return response;
  return <RoleMatrixPage />;
}
```

```tsx
// src/modules/admin/components/RoleMatrixPage.tsx — the original 1161 lines, "use client"
"use client";
export function RoleMatrixPage() {
  // exactly as before
}
```

## Step-by-step (per page)

1. Create the new module component file. Copy the entire current `page.tsx` body (the `"use client"` component) into it as a named export.
2. Replace the `page.tsx` with the ~30-line server wrapper. Move auth gate up to the server side using `requirePermission` + `PERMISSIONS.*`.
3. Update imports in the moved component — paths shift relative to its new location (`@/` aliases stay the same, so this is mostly automatic).
4. If the component has obvious separable pure logic (queries, calc, type maps), extract to `src/modules/<m>/lib/<name>.ts`. **Be conservative** — only extract when the function is testable in isolation and has zero React dependencies.
5. Browser verify: open the page, perform the same flows (CRUD, filter, dialog).
6. `tsc --noEmit`, `npm run build`.

## Lib extractions (modest scope)

Only the obvious wins. Heavy extraction stays inline.

| From | Extract | To |
|---|---|---|
| `RoleMatrixPage.tsx` | permission matrix flatten/diff | `src/modules/admin/lib/permissionMatrix.ts` (if non-trivial) |
| `SubStatusManagerPage.tsx` | transition graph build/validate | `src/modules/repairing/lib/subStatusGraph.ts` (if non-trivial) |
| `YearEndingPage.tsx` | reuse `accountancy/lib/closingStock.ts` — don't reimplement | (no new file) |

## Verification (per page)

- [ ] `app/.../page.tsx` is < 50 lines and only imports + auth gate + render
- [ ] Module component file is `"use client"` and contains all state/handlers
- [ ] Browser: open page, list loads
- [ ] Browser: create flow works
- [ ] Browser: edit flow works
- [ ] Browser: delete flow works
- [ ] Browser: any modal/dialog opens and closes
- [ ] `tsc --noEmit` clean
- [ ] `npm run build` clean

## Risks

- Server/client boundary leak: server wrappers must not import the `"use client"` component's internal types from above the `"use client"` directive. Use `import type` where possible.
- Permission gates: all six pages currently gate via custom hooks or layouts. Confirm the `requirePermission(PERMISSIONS.SETTINGS_MANAGE)` (or correct ID) gate matches the previous behaviour — no looser, no stricter.

## Rollback

Per-page revert is safe. Each page is independent.


---

## Adapting to new findings during execution

If while running this plan you discover that an assumption is stale — file paths drifted, scope counts are wrong, a helper already exists elsewhere, a sweep produces fewer or more hits than estimated — **update the relevant plan files in the same PR before committing**. Do not silently work around the divergence: the next plan in the sequence may rely on the path or symbol you just changed, and the next agent (or human) reads the plan cold. Add a short "Post-execution notes" section recording what actually happened, mirroring the pattern set by [01-layout-sweep.md](01-layout-sweep.md) and [02-utility-quick-wins.md](02-utility-quick-wins.md).
