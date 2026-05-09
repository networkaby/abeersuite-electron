# Seed Files

All seed scripts live in `prisma/seeds/`. To bootstrap a fresh database:

```bash
pnpm prisma db push       # 1. create schema
pnpm seed:all             # 2. baseline → org → accounts → db-checks
# dev-only, run manually if you want demo data:
pnpm seed:dummy-users     # demo logins (admin/tech/front/des @networkservice.in)
pnpm seed:dummy-shop      # demo product catalog
```

Each seed is idempotent — safe to re-run.
**Production:** run only `seed:all`. Skip the `dummy-*` files (or delete them after dev).

---

## Production seeds (run as `seed:all`)

### 1. `prisma/seeds/baseline.ts` — `pnpm seed:baseline`

Wired as the official Prisma seed (`prisma.config.ts → migrations.seed`).
Seeds:
- 4 roles (R1 Admin, R2 Technician, R3 Front Desk, R4 Despatch)
- ~80 permissions + role-permission grants
- 7 pipelines (P1–P7) with statuses (S1–S49)
- Sub-status groups + 37 sub-statuses + transitions

### 2. `prisma/seeds/org.ts` — `pnpm seed:org`

Depends on roles existing. Seeds:
- Role ranks (R1=100, R2=70, R3=20, R4=20)
- 4 branches (BR-HQ, BR-MIR, BR-CTG, BR-ONL)
- 7 cross-branch departments

### 3. `prisma/seeds/accounts.ts` — `pnpm seed:accounts`

Single source of truth for the chart of accounts. Seeds:
- 28 standard Tally account groups (15 primary + 13 sub-groups)
- ~75 GL ledger accounts, every one mapped to a group
- Legacy US-style codes preserved on the merged Tally accounts (`1000` Cash, `1010` Bank Account, `1100` Accounts Receivable, `2100` Tax Payable, `4000` Service Charges Income, `4150` Shop Sales Revenue, `CASH-WALKIN` Walk-in Cash Customer, etc.) so existing code paths keep resolving
- Step 0 migrates legacy US-style names → Tally names (Owner's Capital → Capital, Service Revenue → Service Charges Income, Rent Expense → Rent, Salaries Expense → Salary & Wages) and moves any journal/voucher lines along
- Step 1 dedupes orphan GL accounts by name (case-insensitive)
- Step 3 backfills any customer/company `Account` with `groupId = NULL` → Sundry Debtors

### 4. `prisma/seeds/db-checks.ts` — `pnpm seed:db-checks`

Adds `Phone_owner_xor` + `Email_owner_xor` CHECK constraints (each Phone/Email row owned by exactly one of `personId`/`companyId`). Prisma can't express XOR in the schema DSL, so we apply via raw SQL.

---

## Dummy seeds (dev only, NOT in `seed:all`)

### 5. `prisma/seeds/dummy-users.ts` — `pnpm seed:dummy-users`

4 demo logins with predictable passwords (admin123, tech123, front123, des123). Prints a "DUMMY DATA" banner.

### 6. `prisma/seeds/dummy-shop.ts` — `pnpm seed:dummy-shop`

Full demo shop catalog (products, imagery, descriptions). Source data lives in `src/lib/shop/demo-catalog-seed.ts`.

---

## Schema invariants

`Account.type` was **removed** as of this rework. Account section type now derives from the parent `AccountGroup.type` (`ASSET | LIABILITY | INCOME | EXPENSE`). UI consumers:
- [src/app/(protected)/office/accountancy/chart-of-accounts/page.tsx](src/app/(protected)/office/accountancy/chart-of-accounts/page.tsx) groups rows by `a.group?.type`
- [src/utils/constants.ts](src/utils/constants.ts) exports the 4-element `GL_TYPE_ORDER`
- [src/modules/accountancy/lib/groupNature.ts](src/modules/accountancy/lib/groupNature.ts) — `defaultNormalBalanceForGroupType(type)` derives DEBIT/CREDIT from group type

Legacy code paths still using numeric codes (resolve via the merged accounts):
- [src/lib/post-invoice-je.ts](src/lib/post-invoice-je.ts) — codes 1100, 4000, 2100
- [src/modules/ecommerce/lib/order-status.ts](src/modules/ecommerce/lib/order-status.ts) — codes 1010, 4150
- [src/modules/shared/components/PartyPicker/index.tsx](src/modules/shared/components/PartyPicker/index.tsx) — code CASH-WALKIN

These will get rewritten to Tally name lookup + customer-account-direct + CGST/SGST split when the ticket↔invoice link and shop-order JE rework lands.

---

## Other scripts in `prisma/` (not seeds)

- `prisma/migrate-accounts.ts` — one-time historical backfill (creates `Account` for `Person` rows missing one). Likely already run.
- `prisma/smoke-test-people.ts` — Person/Phone/Email rename smoke test, not a seed.
