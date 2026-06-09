# Seeds

All seed scripts and their fixture data live under `prisma/seeds/`.

```
prisma/seeds/
├─ bootstrap-seed.ts            PRODUCTION — single source of truth for setup
├─ helper-inventory-masters.ts  HELPER — trade-specific masters (brands, categories, HSN/GST groups)
├─ hard-clean.ts                CLEANER — wipes everything bootstrap doesn't seed
├─ purge-vouchers.ts            OPS — wipes only vouchers/JEs/invoices/payments
├─ recompute-balances.ts        OPS — recompute Account.balance drift from JournalLine
├─ dummy-users.ts               DEV — 3 demo non-admin staff logins + basic Posts
├─ dummy-org-rich.ts     DEV — 36 users, 36 posts, 5 branches, 10 depts (org chart demo)
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
pnpm prisma db seed       # 2. runs bootstrap-seed.ts
```

`bootstrap-seed.ts` is **idempotent** — safe to re-run. It seeds:

- **RBAC** — 7 roles (prefixed `Role-`), 80+ permissions, RolePermission grants
- **Workflow** — 6 pipelines, 49 ticket statuses, 7 sub-status groups, 38 sub-statuses, transitions
- **Org structure** — 2 branches (HQ + Online), 7 cross-branch departments, role ranks
- **Chart of accounts** — 28 AccountGroups (Tally tree, 15 primary + 13 sub) + ~50 GL ledgers; per-branch Vault accounts + POS counter till accounts
- **Inventory Unit master** — 13 units (PCS, NOS, BOX, SET, UNIT, MTR, ROLL, PKT, PAIR, KG, BAG, REAM, DAY)
- **Inventory Warranty Term master** — ~10 terms (No Warranty, 7/15-day, 1/3/6-month, 1/2/3/5-year)
- **Org Defaults** — default GST rate (18%), default unit (UNIT), taxability (TAXABLE), currency (₹), credit periods (0 days)
- **DB constraints** — `Phone_owner_xor`, `Email_owner_xor` CHECK constraints (Prisma can't express XOR; applied via raw SQL inside the seed)

> **Universal vs trade-specific.** Bootstrap seeds only masters common to **every** trade (units, GST slabs, warranty terms, chart of accounts, RBAC, workflow). Masters that are **specific to the computer/CCTV/printer trade** — brands, categories, and the HSN/GST product-group spine — are NOT in bootstrap; they live in the helper seed below. A different trade would ship its own helper.

> Production deployments run `pnpm prisma db seed` (mandatory) then, for this trade, `pnpm seed:helper-inventory`. Do not run any `dummy-*` script in production.

## Helper seed (trade-specific reference data)

```bash
pnpm seed:helper-inventory   # after `pnpm prisma db seed`
```

`helper-inventory-masters.ts` is **real, production-usable** reference data — not demo/fake — but trade-specific, so it's kept out of bootstrap. Idempotent (upsert-by-name). Seeds:

- **InvBrand** — ~60 brands (computers, storage, printers, CCTV, networking, peripherals)
- **InvCategory** — 7 use-case categories (Laptops, Desktops, Printers, CCTV & Security, Components, Monitors, Networking)
- **InvProductGroup** — HSN/GST tax-spine tree (~66 groups; each leaf carries an HSN code + GST slab so products inherit tax classification by walking up the parent chain)

Wiped by `hard-clean` (all three are in its `INVENTORY_MASTERS` list) — re-run this helper to restore.

## Dummy seeds (dev only)

Manual, idempotent, **never** auto-run by Prisma. Use for demos, screenshots, local testing.

| Script | Purpose |
|---|---|
| `pnpm seed:dummy-users` | 3 demo logins (`tech@`, `front@`, `des@networkservice.in`) with predictable passwords + 3 basic Posts (Tech HQ, Front HQ, Despatch HQ) |
| `pnpm seed:dummy-org-rich` | Full org chart demo: 36 users, 36 posts, 5 branches (BR-HQ + 4 regional), 10 departments — Board/CEO/C-Level/Central + 4 regional branch managers + staff. Stand-alone; does **not** conflict with dummy-users (different emails). |
| `pnpm seed:dummy-customers` | Demo persons + companies with phones/emails + party-linked Account ledgers |
| `pnpm seed:dummy-shop` | Demo product catalog (laptops, desktops, etc.) — reads from `data/demoCatalogSeed.ts` |
| `pnpm seed:dummy-vouchers` | Demo invoices, payments, journal entries |
| `pnpm seed:dummy-all` | Runs in dependency order: customers → users → **helper-inventory** → shop → vouchers (helper runs before shop so demo products resolve their brand / category / group) |

## Cleaner — return to bootstrap state

```bash
pnpm seed:hard-clean
```

`hard-clean.ts` wipes **everything `bootstrap-seed.ts` does NOT seed**:

- All transactions: vouchers, journal entries, invoices, payments, allocations, audits
- All inventory data: stock-ledger, vouchers, products, **brands, categories, product groups** (trade-specific helper data)
- All attribute masters (InvAttributeMaster — seeded by dummy-shop)
- All shop orders, repair tickets, CRM leads, social posts, chat messages
- All non-admin Users (only `admin@networkservice.in` survives)
- All Persons / Companies / Phones / Emails
- All party-linked Account rows
- ServiceCenter, ShopCoupon, PortalCredentials
- Payment gateways (`payment_gateways`, Settings → Payment Methods — operator config, bootstrap seeds none). Cleared with an explicit `DELETE` (not a `TRUNCATE … CASCADE`) so the `ON DELETE SET NULL` on `PosCounterPaymentAccount.gatewayId` fires: counter payment rails are **preserved**, just unlinked from the deleted gateways.

**Preserves** everything bootstrap-seed wrote, plus user-set config:
- Roles, Permissions, RolePermissions, Pipelines, Statuses, Branches, Departments
- Chart of accounts (AccountGroup tree + GL ledgers)
- **InvUnit** (13 units) — universal bootstrap data
- **InvWarrantyTerm** (~10 terms) — universal bootstrap data
- OrgDefaults singleton, InvNamingConfig singleton
- Account opening balances, CompanySettings

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
| Data moves from a dummy seed into bootstrap | **remove it from `INVENTORY_MASTERS` / `DUMMY_CONFIG_TABLES`** in `hard-clean.ts` — bootstrap data must survive a hard-clean |

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

