# Segment 05 — Constants

## Goal

Replace 32+ magic strings (permission IDs and account-group names) with typed constants. Lets TypeScript catch typos and lets future renames be a single-file change.

## Files created

- `src/shared/lib/constants/permissions.ts`
- `src/shared/lib/constants/accounting.ts`

## Contracts

### `permissions.ts`
```ts
export const PERMISSIONS = {
  ADMIN_BYPASS: "admin:bypass",
  SETTINGS_MANAGE: "settings:manage",
  SETTINGS_STATUSES: "settings:statuses",
  SETTINGS_PIPELINES: "settings:pipelines",
  ACCOUNTANCY_VIEW_ORG: "accountancy:view:org",
  INVENTORY_MANAGE: "inventory:manage",
  // ... full list — derive from `prisma/seeds/new-seed.ts` (single source of truth per docs/modules/admin.md)
} as const;
export type PermissionId = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
```

### `accounting.ts`
```ts
export const ACCOUNT_GROUPS = {
  SUNDRY_DEBTORS: "Sundry Debtors",
  SUNDRY_CREDITORS: "Sundry Creditors",
} as const;
export type AccountGroupName = (typeof ACCOUNT_GROUPS)[keyof typeof ACCOUNT_GROUPS];
```

## Sweep

### Permission strings (~21 sites)

Replace literal strings like `"settings:statuses"`, `"settings:manage"`, `"accountancy:view:org"`, `"inventory:manage"`, `"admin:bypass"` with `PERMISSIONS.*`.

Hot files (run `Grep('"settings:|"accountancy:|"inventory:|"admin:' src/app)`):
- `src/app/api/ticket-statuses/route.ts`, `[id]/route.ts`
- `src/app/api/sub-statuses/route.ts`, `[id]/route.ts`
- `src/app/api/pipelines/route.ts`, `[id]/route.ts`
- `src/app/api/branches/route.ts`, `[id]/route.ts`
- `src/app/api/departments/route.ts`, `[id]/route.ts`
- `src/app/api/roles/route.ts`, `[id]/route.ts`
- `src/app/api/users/route.ts`, `[id]/route.ts`
- `src/app/(protected)/office/(admin)/statuses/layout.tsx`
- `src/app/(protected)/office/(admin)/pipelines/layout.tsx`
- (continue Grep result)

### Account-group strings (~11 sites)

Replace `"Sundry Debtors"` and `"Sundry Creditors"` literals with `ACCOUNT_GROUPS.*`.

Hot files (run `Grep('"Sundry (Debtors|Creditors)"' src)`):
- `src/app/api/people/route.ts` (Zod enum)
- `src/modules/accountancy/components/JournalVoucherDialog.tsx`
- `src/modules/accountancy/lib/postInvVoucher.ts`
- `src/modules/accountancy/lib/outstandings.ts`
- `src/app/api/finance/reports/receivables/route.ts`
- `src/app/api/finance/reports/payables/route.ts`
- `src/app/api/finance/reports/ratio-analysis/route.ts`

## Step-by-step

1. Build the `PERMISSIONS` object — copy IDs from `prisma/seeds/new-seed.ts` (the documented source of truth).
2. Build `ACCOUNT_GROUPS`.
3. Sweep with the Grep queries above. For Zod enums (`z.enum(["Sundry Debtors", ...])`), use the constant inside the array literal.
4. `tsc --noEmit` will catch any typo'd strings now.

## Verification

- [x] `PERMISSIONS` covers every permission ID found in `prisma/seeds/bootstrap-seed.ts`
- [x] `ACCOUNT_GROUPS` covers Sundry Debtors + Sundry Creditors
- [x] No remaining permission-id literals at call sites (some left intentionally — see post-execution notes)
- [x] No remaining `"Sundry Debtors"` / `"Sundry Creditors"` runtime literals (kept in 1 comment + 2 type-union annotations + 2 user-facing UI labels)
- [x] `tsc --noEmit` clean
- [x] `npm run build` clean
- [x] Browser: 12 permission-gated endpoints all return 200 (including receivables / payables / ratio-analysis that consume `ACCOUNT_GROUPS`)

## Post-execution notes (2026-05-11)

Status: **complete** — `tsc --noEmit` clean, `npm run build` clean, smoke 12/12 200.

Scope:

- `src/shared/lib/constants/permissions.ts` — 90+ `PERMISSIONS.*` entries derived from `prisma/seeds/bootstrap-seed.ts` (originally referred to as `new-seed.ts` in the plan, now consolidated). Exports `PermissionId` type union.
- `src/shared/lib/constants/accounting.ts` — `ACCOUNT_GROUPS = { SUNDRY_DEBTORS, SUNDRY_CREDITORS }` + `AccountGroupName` type.

Sweeps:

| Pattern | Files | Replacements |
|---|---|---|
| `requirePermission("…")` / `hasPermission(_, "…")` / `makePermissionLayout("…")` / `permissions.includes("…")` | 147 | 227 |
| `ACCOUNT_GROUPS` literals (where = / arg / default value / array element / ternary comparand) | 8 | 10 |

Account-group literals **kept inline on purpose**:

- 2 type-union annotations (`"Sundry Debtors" \| "Sundry Creditors"`) in `PartyCombobox.tsx` — TypeScript literal-type union for prop typing. Could refactor to `AccountGroupName`; deferred to keep diff small.
- 1 Zod enum in `src/app/api/people/route.ts` (`z.enum(["Sundry Debtors", "Sundry Creditors"])`) — Zod enums work with literal strings; const-assertion swap would need broader typing care.
- 2 user-facing UI labels in `ratio-analysis/page.tsx` (`<Row label="Sundry Debtors" ...>`). These are intentionally human-readable labels.
- A handful of comments referencing the names. Documentation, not runtime.

Per AGENTS.md "after every plan" rule:

- **Reusables registry** — `docs/reusables.md` Constants section added.
- **Module docs** — none touched; constants are cross-cutting. Module docs can adopt `PERMISSIONS.*` in their "Permissions" sections in a future polish pass.
- **Todo list** — completed.


---

## Adapting to new findings during execution

If while running this plan you discover that an assumption is stale — file paths drifted, scope counts are wrong, a helper already exists elsewhere, a sweep produces fewer or more hits than estimated — **update the relevant plan files in the same PR before committing**. Do not silently work around the divergence: the next plan in the sequence may rely on the path or symbol you just changed, and the next agent (or human) reads the plan cold. Add a short "Post-execution notes" section recording what actually happened, mirroring the pattern set by [01-layout-sweep.md](01-layout-sweep.md) and [02-utility-quick-wins.md](02-utility-quick-wins.md).
