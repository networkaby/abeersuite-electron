# Seeds

All seed scripts and their fixture data live under `prisma/seeds/`.

```
prisma/seeds/
├─ bootstrap-seed.ts     PRODUCTION — single source of truth for setup
├─ hard-clean.ts         CLEANER — wipes everything bootstrap doesn't seed
├─ purge-vouchers.ts     OPS — wipes only vouchers/JEs/invoices/payments
├─ dummy-users.ts        DEV — 3 demo non-admin staff logins
├─ dummy-customers.ts    DEV — demo customers + companies
├─ dummy-shop.ts         DEV — demo product catalog (consumes data/demoCatalogSeed.ts)
├─ dummy-vouchers.ts     DEV — demo vouchers + journal entries
└─ data/
   └─ demoCatalogSeed.ts FIXTURE — hardcoded product list used by dummy-shop
```

## Production seed

The official Prisma seed is wired in [`prisma.config.ts`](../prisma.config.ts):

```ts
migrations: { seed: "pnpm exec tsx prisma/seeds/bootstrap-seed.ts" }
```

Run on a fresh database:

```bash
pnpm prisma db push       # 1. apply schema
pnpm prisma db seed       # 2. runs bootstrap-seed.ts (auto-runs after `prisma migrate reset`)
```

`bootstrap-seed.ts` is **idempotent** — safe to re-run. It seeds:

- **RBAC** — 4 roles, 80+ permissions, RolePermission grants
- **Workflow** — 6 pipelines, 49 ticket statuses, 7 sub-status groups, 38 sub-statuses, transitions
- **Org structure** — 2 branches (HQ + Online), 7 cross-branch departments, role ranks
- **Chart of accounts** — 28 AccountGroups (Tally tree, 15 primary + 13 sub) + ~50 GL ledgers; legacy US-style codes preserved on merged accounts
- **DB constraints** — `Phone_owner_xor`, `Email_owner_xor` CHECK constraints (Prisma can't express XOR; applied via raw SQL inside the seed)

> Production deployments run **only** `pnpm prisma db seed`. Do not run any `dummy-*` script in production.

## Dummy seeds (dev only)

Manual, idempotent, **never** auto-run by Prisma. Use for demos, screenshots, local testing.

| Script | Purpose |
|---|---|
| `pnpm seed:dummy-users` | 3 demo logins (`tech@`, `front@`, `des@networkservice.in`) with predictable passwords |
| `pnpm seed:dummy-customers` | Demo persons + companies with phones/emails + party-linked Account ledgers |
| `pnpm seed:dummy-shop` | Demo product catalog (laptops, desktops, etc.) — reads from `data/demoCatalogSeed.ts` |
| `pnpm seed:dummy-vouchers` | Demo invoices, payments, journal entries |
| `pnpm seed:dummy-all` | Runs all four in dependency order: customers → users → shop → vouchers |

## Cleaner — return to bootstrap state

```bash
pnpm seed:hard-clean
```

`hard-clean.ts` wipes **everything `bootstrap-seed.ts` does NOT seed**:

- All transactions: vouchers, journal entries, invoices, payments, allocations, audits
- All inventory data: stock-ledger, vouchers, products, units, categories, brands, warranty terms
- All shop orders, repair tickets, CRM leads, social posts, chat messages
- All non-admin Users (only `admin@networkservice.in` survives)
- All Persons / Companies / Phones / Emails
- All party-linked Account rows
- ServiceCenter, ShopCoupon, PortalCredentials

Preserves everything bootstrap-seed wrote, plus user-set config (opening balances, CompanySettings).

> **Destructive.** Vouchers + customers + products are unrecoverable. Use only in dev.

After cleaning, repopulate demo data with `pnpm seed:dummy-all`.

## Narrower cleaner

```bash
pnpm seed:purge-vouchers
```

Wipes only voucher/journal/invoice/payment tables — useful when you want to re-test posting flows without nuking customers and inventory.

## Fixture data (`prisma/seeds/data/`)

Pure data — TS objects exported as constants, no DB or runtime logic. Each file is consumed by exactly one dummy seed script.

| File | Consumed by |
|---|---|
| `data/demoCatalogSeed.ts` | `dummy-shop.ts` |

Future fixtures (dummy customer lists, voucher fixtures, etc.) go here too rather than being inlined into the dummy-* script.

## Update rules — when to touch what

| Change | Update |
|---|---|
| Add / rename / drop a column on a **Prisma model** | `bootstrap-seed.ts` AND any `dummy-*.ts` that writes to the table — same commit as the schema change |
| Add a new permission / role / pipeline / status / sub-status | `bootstrap-seed.ts` |
| Add a new account group or default GL ledger | `bootstrap-seed.ts` |
| Add a new tax / payment method / business invariant | `bootstrap-seed.ts` |
| Add a new demo user / customer / product type | the relevant `dummy-*.ts` |
| Add a new fixture data file | `prisma/seeds/data/<name>.ts`; document the consumer here |
| Add a new dummy script | wire into `package.json` `scripts` and into `seed:dummy-all` |
| Hard-clean must remove a new dummy table | extend `TRANSACTION_TABLES` / `INVENTORY_MASTERS` / `DUMMY_CONFIG_TABLES` in `hard-clean.ts` |

> **Schema-and-seed coupling rule:** any commit that changes `prisma/schema/*.prisma` must also update `bootstrap-seed.ts` (production) and the matching `dummy-*.ts` (dev) in the same commit. The dummy scripts are the canonical demo for that schema; if they break after a schema change, future agents have no working reference.

## Demo logins (after `seed:dummy-users`)

| Email | Role | Password |
|---|---|---|
| `admin@networkservice.in` | R1 Admin (seeded by **bootstrap**, not dummy) | `admin123` |
| `tech@networkservice.in` | R2 Technician | `tech123` |
| `front@networkservice.in` | R3 Front Desk | `front123` |
| `des@networkservice.in` | R4 Despatch | `des123` |

## Schema invariants enforced by seeds

- `Account.type` is **removed** — section type derives from `AccountGroup.type` (`ASSET | LIABILITY | INCOME | EXPENSE`). UI groups by `a.group?.type`.
- Stock-in-Hand `AccountGroup` is intentionally empty in bootstrap — closing-stock is computed dynamically, not stored.
- Phone/Email rows are owned by exactly one of `personId` / `companyId` (XOR CHECK constraint applied by bootstrap).

## Other scripts in `prisma/` (NOT seeds)

These live at the prisma root, not under `seeds/`:

- [`prisma/migrate-accounts.ts`](../prisma/migrate-accounts.ts) — one-time historical backfill (creates `Account` for `Person` rows missing one). Likely already run on existing databases.
- [`prisma/smoke-test-people.ts`](../prisma/smoke-test-people.ts) — Person/Phone/Email smoke test, not a seed.
