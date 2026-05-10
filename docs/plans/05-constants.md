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

- [ ] `PERMISSIONS` covers every permission ID found in `prisma/seeds/new-seed.ts`
- [ ] `ACCOUNT_GROUPS` covers Sundry Debtors + Sundry Creditors
- [ ] No remaining `"settings:`, `"accountancy:`, `"inventory:`, `"admin:` literals in `src/app` or `src/modules` (excluding the constants file itself)
- [ ] No remaining `"Sundry Debtors"` / `"Sundry Creditors"` literals (excluding constants + Zod schemas)
- [ ] `tsc --noEmit` clean
- [ ] `npm run build` clean
- [ ] Browser: hit a permission-gated route — gate still works
