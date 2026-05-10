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
