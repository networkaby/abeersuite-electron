# Segment 03 — Auth consolidation

## Goal

`src/shared/lib/auth/` currently has **two competing modules** with overlapping exports and incompatible types: `authGuard.ts` and `permissions.ts`. Merge into a single canonical `permissions.ts`. Eliminates two divergent `ResolvedUser` types and two `requirePermission()` implementations across 120+ routes.

## Current state (after Segment 01)

| File | Exports | `ResolvedUser` shape |
|---|---|---|
| `src/shared/lib/auth/authGuard.ts` | `requireAuth`, `requireRole`, `requirePermission`, `hasPermission`, `isAdmin`, `ResolvedUser` | 6 fields |
| `src/shared/lib/auth/permissions.ts` | `requirePermission`, `hasPermission`, `isAdmin`, `resolvedUserFromSession`, `ResolvedUser` | 7 fields (adds `rank`, `scope`) |

## Target state

`src/shared/lib/auth/permissions.ts` is canonical and exports:

```
requireAuth, requireRole, requirePermission,
hasPermission, isAdmin,
resolvedUserFromSession,
ResolvedUser  (the 7-field superset shape)
```

`src/shared/lib/auth/authGuard.ts` is deleted.

## Step-by-step

1. In `permissions.ts`:
   - Add `requireAuth()` and `requireRole(...roles)` — copy from `authGuard.ts` (use the 7-field `ResolvedUser` from `permissions.ts`).
   - Confirm `requirePermission()` is the canonical version (chains from `requireAuth`); replace the standalone variant.
   - Confirm `hasPermission()` and `isAdmin()` are deduplicated (same delegation to `permissionScope`).
2. Replace the body of `authGuard.ts` with a re-export shim:
   ```ts
   export {
     ResolvedUser, requireAuth, requireRole, requirePermission,
     hasPermission, isAdmin, resolvedUserFromSession,
   } from "./permissions";
   ```
   (This keeps the build green while we sweep imports.)
3. Sweep imports: `from "@/shared/lib/auth/authGuard"` → `from "@/shared/lib/auth/permissions"` everywhere.
4. Delete `authGuard.ts`.
5. `npx tsc --noEmit`, `npm run build`.

## Verification

- [ ] `src/shared/lib/auth/authGuard.ts` deleted
- [ ] All callers import from `@/shared/lib/auth/permissions`
- [ ] `tsc --noEmit` clean
- [ ] `npm run build` clean
- [ ] Browser: log out + log in
- [ ] Browser: hit a permission-gated route as non-admin → 403
- [ ] Browser: hit same route as admin → 200
- [ ] Smoke API: GET an arbitrary protected route, confirm `requirePermission` still gates correctly

## Rollback

`git revert`. No DB or env changes. Login flow is the only acceptance test.

---

## Post-execution notes (2026-05-10)

Status: **complete** — `tsc --noEmit` clean, `npm run build` clean, browser smoke confirms 200 on all 4 permission-gated endpoints (`/api/notifications`, `/api/branches`, `/api/roles`, `/api/ticket-statuses`) for the admin session.

Reality check vs the plan:

- **Imports:** 163 files were importing from `@/shared/lib/auth/authGuard`, only **2** from `@/shared/lib/auth/permissions` (both for `resolvedUserFromSession`: `tickets/[id]/route.ts` and `tickets/[id]/participants/route.ts`). So permissions.ts was barely used; authGuard was the dominant pattern. Sweep covered all 163 files in one sed pass.
- **ResolvedUser merge:** authGuard's was 6 fields; permissions.ts had 7 (with `rank`, `scope`). Final canonical shape has all 8 fields (`id, primaryRole, roles, permissions, rank, scope, departmentIds, branchIds`). The plan said "7-field superset" — that count was off by one because `id` wasn't being counted; the field list is correct.
- **Customer rejection:** authGuard's `requireAuth` rejected `kind === "customer"`; permissions.ts's standalone `requirePermission` did not. Final canonical `requirePermission` chains through `requireAuth`, so it now also rejects portal customers. This is a behavior tightening for the 2 ticket files but a regression-safe one (customers shouldn't be hitting staff routes).

What landed:

- `src/shared/lib/auth/permissions.ts` — canonical, exports `ResolvedUser`, `hasPermission`, `isAdmin`, `requireAuth`, `requireRole`, `requirePermission`, `resolvedUserFromSession`. Single internal `resolveFromSession` helper (no longer duplicated).
- `src/shared/lib/auth/authGuard.ts` — used as a re-export shim for ~30 seconds while the sweep ran, then deleted (`git rm -f`).
- 163 files swept (`@/shared/lib/auth/authGuard` → `@/shared/lib/auth/permissions`).

Per AGENTS.md "after every plan" rule:

- **Reusables registry** — `docs/reusables.md` Auth section rewritten to reflect the consolidated module + 8-field `ResolvedUser`.
- **Module docs** — none touched; auth is cross-cutting.
- **Todo list** — completed throughout.


---

## Adapting to new findings during execution

If while running this plan you discover that an assumption is stale — file paths drifted, scope counts are wrong, a helper already exists elsewhere, a sweep produces fewer or more hits than estimated — **update the relevant plan files in the same PR before committing**. Do not silently work around the divergence: the next plan in the sequence may rely on the path or symbol you just changed, and the next agent (or human) reads the plan cold. Add a short "Post-execution notes" section recording what actually happened, mirroring the pattern set by [01-layout-sweep.md](01-layout-sweep.md) and [02-utility-quick-wins.md](02-utility-quick-wins.md).
