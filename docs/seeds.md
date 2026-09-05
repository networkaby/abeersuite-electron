# Seeds

All seed scripts and their fixture data live under `prisma/seeds/`.

```
prisma/seeds/
├─ bootstrap-seed.ts            GENERIC — new-client installer (run via `pnpm seed:generic`)
├─ export-personal.ts           PERSONAL — reverse-create YOUR config snapshot from the live DB
├─ personal-bootstrap.ts        PERSONAL — what `pnpm prisma db seed` runs: code-owned catalog + your snapshot (self-complete)
├─ helper-brands.ts             HELPER — trade-specific brand master (InvBrand)
├─ helper-inventory-masters.ts  HELPER — trade-specific masters (categories, HSN/GST groups)
├─ helper-roles.ts              HELPER — trade-specific starter roles (R2–R7, non-system / admin-editable)
├─ apply-permissions.ts         APPLY — add just the `ADDITIONS` permissions + grant to R1 (live; the normal way to ship a permission)
├─ apply-backup-config.ts       APPLY — create the BackupConfig singleton (the ONLY thing that creates it)
├─ apply-voucher-series-counters.ts APPLY — give every VoucherSeries its counter-1 row
├─ apply-taxonomy.ts            APPLY — classify group + brand on the real catalog from product names (`--dry` previews)
├─ hard-clean.ts                CLEANER — wipes everything bootstrap doesn't seed
├─ purge-vouchers.ts            OPS — wipes only vouchers/JEs/invoices/payments
├─ purge-demo-contacts.ts       OPS — wipes contacts (+ transactions), keeps products + settings
├─ purge-demo-products.ts       OPS — wipes products (+ transactions), keeps contacts + settings
├─ recompute-balances.ts        OPS — recompute Account.balance drift from JournalLine
├─ lib/
│  ├─ purgeDemo.ts       SHARED — transaction table list + purge steps for the demo cleaners
│  ├─ assertNotCounter.ts SHARED — refuse to run a destructive seed against a counter machine
│  ├─ positionSeedSync.ts SHARED — upsert a position + its role-template links
│  ├─ codeOwnedCatalog.ts SHARED — code-owned data both bootstraps use: the permission catalog, XOR CHECK constraints, voucher series. ADD NEW PERMISSIONS HERE.
│  ├─ personalSnapshot.ts SHARED — export/import engine for the personal snapshot
│  └─ personalSnapshotPath.ts SHARED — on-disk path of the snapshot (git-tracked in this private repo)
└─ data/
   └─ personal.local.json YOUR CONFIG — the captured snapshot personal-bootstrap replays
```

> **There are no `dummy-*` seeds any more.** The demo-data scripts (users, org-rich,
> customers, shop, vouchers, tasks, deals) and their `demoCatalogSeed.ts` fixture were
> deleted — they had drifted behind the schema and nobody was running them. If a demo
> is needed again, write a fresh script here and wire it into `package.json`; do not
> resurrect the old ones from git history without checking them against the schema first.
>
> Every seed left in this folder is one you would actually run on a real install.

## The official seed — `pnpm prisma db seed` = PERSONAL

The Prisma seed wired in [`prisma.config.ts`](../prisma.config.ts) is the
**personal bootstrap**, not the generic installer:

```ts
migrations: { seed: "pnpm exec tsx prisma/seeds/personal-bootstrap.ts" }
```

```bash
pnpm prisma db push       # 1. apply schema
pnpm prisma db seed       # 2. personal bootstrap: code-owned catalog + your snapshot (upsert-only)
```

It is **non-destructive** (upsert-only; its only delete is pruning permissions
retired from code), so re-running it on the live DB re-asserts your config
without touching transactions. The dev loop is **capture → edit → seed** (see
the Personal bootstrap section below).

## Generic bootstrap — the new-client installer

`bootstrap-seed.ts` runs via `pnpm seed:generic` and is ONLY for a brand-new
client with no captured config: it creates the generic demo world (baseline GST
18%, ₹, starter tier ladder …). **Do not run it during
normal development** — re-running it resets tuned settings back to generic.

`bootstrap-seed.ts` is **idempotent** — safe to re-run on a fresh install. It seeds:

- **RBAC** — **1 role** (`R1` Admin, the only `isSystem` role; homed in the all-access `DEP-ADMIN` department so its Role Matrix shows the full permission list), 130+ permissions, R1's RolePermission grants. Permissions include a **per-kind voucher gate** for every hand-created voucher kind — GL kinds in the `finance:voucher:<action>:<kind>` namespace, inventory kinds in `inventory:voucher:<action>:<kind>` — generated from `src/shared/lib/auth/voucherMatrix.ts` so the mapping never drifts. The other starter roles (`R2`–`R7`) are trade-specific and live in `helper-roles.ts` (see below); admins build the rest from the Role Matrix.
- **Workflow** — 6 pipelines, 49 ticket statuses, 7 worker groups, 38 workers, transitions
- **Org structure** — 1 branch (HQ; admins add regional / online branches via the UI), 8 cross-branch departments (incl. `DEP-ADMIN`, the all-access dept — `Department.isAllAccess`, whose permission pool is "everything"), role ranks. Department rows are seeded in the RBAC section because `Role.departmentId` is a required FK that needs `DEP-ADMIN` to exist before roles.
- **Chart of accounts** — 28 AccountGroups (Tally tree, 15 primary + 13 sub) + ~50 GL ledgers; per-branch Vault accounts + POS counter till accounts
- **Inventory Unit master** — 13 units (PCS, NOS, BOX, SET, UNIT, MTR, ROLL, PKT, PAIR, KG, BAG, REAM, DAY)
- **Inventory Warranty Term master** — ~10 terms (No Warranty, 7/15-day, 1/3/6-month, 1/2/3/5-year)
- **Org Defaults** — default GST rate (18%), default unit (UNIT), taxability (TAXABLE), currency (₹), credit periods (0 days)
- **DB constraints** — `Phone_owner_xor`, `Email_owner_xor` CHECK constraints (Prisma can't express XOR; applied via raw SQL inside the seed)

> **Universal vs trade-specific.** Bootstrap seeds only masters common to **every** trade (units, GST slabs, warranty terms, chart of accounts, the `R1` Admin role, workflow). Masters that are **specific to the computer/CCTV/printer trade** — brands, categories, the HSN/GST product-group spine, and the `R2`–`R7` starter roles — are NOT in bootstrap; they live in the helper seeds below. A different trade would ship its own helpers (or just build roles in the Role Matrix).

> Production deployments run `pnpm prisma db seed` (mandatory) then, for this trade, `pnpm seed:helper-all` (roles → brands → inventory masters).

## Personal bootstrap — self-complete restore of YOUR install

The personal bootstrap does **not** run the generic installer. It stands up a
working install from two sources and nothing else:

1. **Code-owned catalog** (`lib/codeOwnedCatalog.ts`) — the permission catalog
   (upsert + prune of retired ids), the Phone/Email XOR CHECK constraints, and
   the voucher numbering series. Exactly the three things the snapshot
   deliberately never carries because they belong to the code.
2. **Your snapshot** (`data/personal.local.json`) — every piece of real config.
3. **R1 top-up** — R1 (Admin) is granted any catalog permission it doesn't
   already hold, so code-added permissions reach the admin role without waiting
   for a re-capture.

The dev loop — **capture → edit → seed**:

```bash
# 1. Capture — "reverse create" your snapshot from the live DB (READ-ONLY).
#    Re-run any time you change settings in the UI.
pnpm seed:personal:capture      # → prisma/seeds/data/personal.local.json

# 2. (optional) Hand-edit the snapshot JSON.

# 3. Seed — re-apply catalog + snapshot. Non-destructive; safe on the live DB.
pnpm prisma db seed             # or: pnpm seed:personal
pnpm seed:personal --overlay-only   # skip the catalog step; overlay only
```

After a **hard reset** (fresh DB before go-live): `pnpm prisma db push`, then
`pnpm prisma db seed` — the client's full config comes back with zero generic
demo clutter. Reset staff passwords after (new users get `changeme123`).

**Scope — "everything except tickets, vouchers, customers, products".**

| Included (config / structure / masters) | Excluded |
|---|---|
| Config singletons — `OrgDefaults`, `InvNamingConfig`, `LoyaltyConfig`, `CouponConfig`, `CreditLimitConfig`, `BooksConfig` | `Ticket*` (tickets) |
| Inventory/tax masters — `GstRate`, `InvUnit`, `InvWarrantyTerm`, `InvCategory`, `InvProductGroup`, `InvBrand`, `InvAttributeMaster`, `StrategyPoint`, `VoucherPrintTemplate` | `UniversalVoucher*` / journal / invoice / payment / stock-ledger (vouchers) |
| Chart of accounts — `AccountGroup` + `Account` (+ its `AccountAlias` rows) **(GL ledgers only)** | `Person` / `Company` / `Phone` / `Email` / party ledgers (customers) |
| Spend-tier ladders — `CustomerTierPeriod` + `CustomerTier` | `InvProduct*` (products) |
| Org structure — `Branch`, `Department` | `Coupon` / `GiftCard` / `LoyaltyEarnRule` / `LoyaltyMilestone` (entangle products + customers — only the **config singletons** above are kept) |
| RBAC — `Role`, `RolePermission`, `DepartmentPermission`, `Position`, `PositionRole`, staff `User` + `UserPosition` / `UserPermission` (Permission rows themselves stay code-owned — `lib/codeOwnedCatalog.ts`) | |
| POS setup — `PaymentGateway`, `PosCounter`, `PosCounterPaymentAccount`, `PosService` | |
| Repair pipeline — `Pipeline`, `WorkGroup`, `Work`, `TicketStatus`, `TicketWorker`, status + worker transitions | |

**How it stays portable.** The RBAC / org / pipeline layers use human-assigned
**string ids** (`R1`, `DEP-ADMIN`, `PIPE-REPAIR` …) that survive a reseed
unchanged, so their rows and join tables port by id. The Int-autoincrement
models (accounts, GST, units, categories, counters, gateways) are referenced
across the snapshot by their **natural key** (account code/name, GST label,
counter branch+name …); the importer re-resolves each ref to the local id, so
nothing breaks even on a fresh database.

**Safety.** The overlay is **upsert-only** — it never deletes. Grants pointing
at permissions no longer present in the current build are dropped (and reported);
POS rails whose account/counter can't be resolved are skipped (and reported).

**Secrets.** Staff **password hashes are never exported** — the snapshot is
scrubbed, so it is safe to commit. A user *created* by the overlay gets the
default password `changeme123` (change it after seeding, and it's reported in
the run summary); existing users keep their own password untouched. The
snapshot still carries your real GSTIN / org identity / tier amounts, so commit
it only to a private repo.

> **Maintenance.** When you add a config table to the schema, add it to
> `lib/personalSnapshot.ts` (both `exportPersonal` and `importPersonal`) so the
> personal snapshot stays complete — same commit as the schema change.

## Helper seed (trade-specific brands)

```bash
pnpm seed:helper-brands   # after `pnpm prisma db seed`
```

`helper-brands.ts` is **real, production-usable** reference data — not demo/fake — but trade-specific, so it's kept out of bootstrap. Idempotent (upsert-by-name). Seeds:

- **InvBrand** — ~60 brands (computers, storage, printers, CCTV, networking, peripherals)

Wiped by `hard-clean` (`InvBrand` is in its `INVENTORY_MASTERS` list) — re-run this helper to restore.

## Helper seed (trade-specific reference data)

```bash
pnpm seed:helper-inventory   # after `pnpm prisma db seed`
```

`helper-inventory-masters.ts` is **real, production-usable** reference data — not demo/fake — but trade-specific, so it's kept out of bootstrap. Idempotent (upsert-by-name). Seeds:

- **InvCategory** — 7 use-case categories (Laptops, Desktops, Printers, CCTV & Security, Components, Monitors, Networking)
- **InvProductGroup** — HSN/GST tax-spine tree (~66 groups; each leaf carries an HSN code + GST slab so products inherit tax classification by walking up the parent chain)

Wiped by `hard-clean` (both are in its `INVENTORY_MASTERS` list) — re-run this helper to restore.

## Helper seed (trade-specific starter roles)

```bash
pnpm seed:helper-roles   # after `pnpm prisma db seed`
```

`helper-roles.ts` creates `R2`–`R7` (Service Engineer, Counter/Cashier, Stores & Despatch, Branch Manager, Accountant, Sales Executive) plus their permission grants. They are **non-system** (`isSystem: false`), so admins can rename, re-grant, or delete them from the Role Matrix — unlike the locked `R1`. Idempotent (upsert-by-id; grants fully rewritten each run). Permission rows come from bootstrap, so run this **after** `pnpm prisma db seed`.

Each role is homed in a department (`R2`→`DEP-REPAIR`, `R6`→`DEP-FIN`, `R7`→`DEP-SALES`, `R3`→`DEP-DESK`, `R4`→`DEP-DESP`; `R5` Branch Manager → `DEP-ADMIN`). This helper also seeds the **department permission pools** (`DepartmentPermission`) for those functional departments — each pool = the union of its roles' permissions, so a role can never grant outside its department's pool (the all-access `DEP-ADMIN` carries no rows; its pool is everything). Pools are trade-specific (they depend on the helper roles), which is why they live here, not in bootstrap.

Wiped by `hard-clean` (it deletes every non-system role back to the R1-only bootstrap state, and clears all `DepartmentPermission` pool rows) — re-run this helper to restore.

## Targeted appliers — a small change without a full seed

Manual, idempotent, **never** auto-run by Prisma. A full `pnpm prisma db seed` re-touches
every master and prunes — wasteful and risky on live when a change only ADDS a few rows.
These do just the one job.

| Script | Purpose |
|---|---|
| `pnpm seed:apply-permissions` | Upserts the `ADDITIONS` permission list and grants the non-`systemOnly` ones to R1. **The normal way to ship a permission** (AGENTS.md §5) — run it after adding the rows to `lib/codeOwnedCatalog.ts` and `src/shared/lib/constants/permissions.ts`. |
| `pnpm seed:apply-backup-config` | Creates the `BackupConfig` singleton (id=1, daily 10 PM IST). **The only thing that creates it** — it is in neither bootstrap nor the personal snapshot, so a fresh install has no backup schedule until this runs. |
| `pnpm seed:apply-voucher-series-counters` | Gives every `VoucherSeries` its counter-1 row in `VoucherSeriesCounter`, carrying the legacy `nextSeq` / `fyStartYear` across. Needed once per DB after the 2026-09-05 per-counter numbering change. |
| `pnpm seed:apply-taxonomy` | Fills `group` + `brand` on the **real** catalog by matching product names, and strips junk name prefixes. Two-pass (head-noun first, then anywhere) and only ever fills NULLs, so manual corrections survive. `--dry` previews. Re-run after a bulk import. |

> These are the only appliers left. A long tail of one-shot `apply-*` / `migrate-*`
> scripts — spent patches for schema shapes that no longer exist — was deleted; what
> they changed is recorded in `bootstrap-seed.ts` and `PROJECT_BRAIN.md`, which is where
> a future reader should look. **Do not add a new one-shot script here unless it will be
> run more than once**; a targeted change that ships with a schema change belongs in
> `bootstrap-seed.ts` plus a note in the commit.

## Cleaner — return to bootstrap state

```bash
pnpm seed:hard-clean
```

`hard-clean.ts` wipes **everything `bootstrap-seed.ts` does NOT seed**:

- All transactions: vouchers, journal entries, invoices, payments, allocations, audits
- All inventory data: stock-ledger, vouchers, products, **brands, categories, product groups** (trade-specific helper data)
- All attribute masters (InvAttributeMaster — added via Configure → Attribute masters)
- All shop orders, repair tickets, CRM leads, social posts, chat messages
- All non-admin Users (only `admin@networkservice.in` survives)
- All Persons / Companies / Phones / Emails
- All party-linked Account rows
- ServiceCenter, ShopCoupon, PortalCredentials
- Payment gateways (`payment_gateways`, Settings → Payment Methods — operator config, bootstrap seeds none). Cleared with an explicit `DELETE` (not a `TRUNCATE … CASCADE`) so the `ON DELETE SET NULL` on `PosCounterPaymentAccount.gatewayId` fires: counter payment rails are **preserved**, just unlinked from the deleted gateways.
- **Non-system roles** (every `Role` with `isSystem: false` — the `helper-roles.ts` starter set and any admin-created role). Positions pointing at them are unlinked first (restrict FK), then the roles + their grants are deleted. Re-run `pnpm seed:helper-roles` to restore the starter set. `R1` (the only `isSystem` role) survives.
- **Department permission pools** (`DepartmentPermission`) — all rows are helper-seeded (bootstrap seeds none; `DEP-ADMIN` is all-access with no rows), so they are cleared back to the bootstrap state. Department rows themselves are bootstrap-seeded and survive. Re-run `pnpm seed:helper-roles` to restore the pools.

**Preserves** everything bootstrap-seed wrote, plus user-set config:
- `R1` role + Permissions + R1's RolePermissions, Pipelines, Statuses, Branches, Departments
- Chart of accounts (AccountGroup tree + GL ledgers)
- **InvUnit** (13 units) — universal bootstrap data
- **InvWarrantyTerm** (~10 terms) — universal bootstrap data
- OrgDefaults singleton, InvNamingConfig singleton, CreditLimitConfig singleton
- Account opening balances, CompanySettings

> **Destructive.** Vouchers + customers + products are unrecoverable. Use only in dev.

After cleaning, restore the trade masters with `pnpm seed:helper-all`. There is no demo
data to repopulate — contacts and products are re-entered through the UI or the CSV importers.

## Narrower cleaner

```bash
pnpm seed:purge-vouchers
```

Wipes only voucher/journal/invoice/payment tables — useful when you want to re-test posting flows without nuking customers and inventory.

## Demo cleaners — contacts and products, separately

```bash
pnpm seed:purge-demo-contacts   # contacts go, products stay
pnpm seed:purge-demo-products   # products go, contacts stay
pnpm seed:purge-demo            # both, in that order
```

These sit between `purge-vouchers` and `hard-clean`: they remove demo **contacts** or the demo **product catalog** while keeping every setting `hard-clean` would have destroyed. Use them when the demo data must go but your UI-configured state must stay.

| Script | Removes | Keeps |
|---|---|---|
| `seed:purge-demo-contacts` | Persons / Companies / Phones / Emails / PersonCompany + party-linked `Account` ledgers | The whole product catalog |
| `seed:purge-demo-products` | `InvProduct` + cascade children (`inv_product_codes`, `inv_product_branches`, `stock_reservations`, `CouponProductRule`, product-scoped `LoyaltyEarnRule`) | All contacts + their ledgers |

> **Both scripts also purge every transaction — this is not optional.** `Account.personId` / `Ticket.personId` / `TicketRepair.personId` are RESTRICT FKs onto the parties, `VoucherInventoryLine.productId` / `InvStockLedger.productId` / `TicketRepair.productId` / `InvBom` are RESTRICT onto the products, and the party ledgers are pinned by `UniversalVoucher.accountId`. Postgres refuses the DELETE while those rows exist, so the books reset to opening-balance state either way. There is no "clean contacts but keep the vouchers" option. `Account.balance` resets to 0; opening-balance fields are untouched.

The shared transaction table list and the purge steps live in **`lib/purgeDemo.ts`** — one copy, consumed by both scripts. (`purge-vouchers.ts` and `hard-clean.ts` still carry their own older, narrower lists; they were left alone.)

**Both preserve** (the difference from `hard-clean`): all Users, all Roles + grants (including non-system / admin-edited ones), `DepartmentPermission` pools, `payment_gateways` + POS counters + counter rails, `ServiceCenter`, **InvBrand / InvCategory / InvProductGroup / InvAttributeMaster**, Coupon + Loyalty config masters, and Chat + WallPost (staff-only — they FK to `User`, never to a party or product). Everything bootstrap seeds survives as usual.

> **Products are removed with `DELETE`, never `TRUNCATE … CASCADE`.** `Coupon.freeProductId` / `.buyProductId` are `onDelete: SetNull`, but Postgres `TRUNCATE … CASCADE` cascades on FK *existence*, ignoring the `onDelete` action — it would truncate the whole `Coupon` table. A `DELETE` fires the SET NULL instead, so coupons survive with their product links blanked.

Re-enter contacts and products through the UI or the customer / product CSV importers.

## `prisma/seeds/data/`

| File | Consumed by |
|---|---|
| `data/personal.local.json` | `personal-bootstrap.ts` (written by `export-personal.ts`) |

This folder is for seed **input**, not for scratch data. Keep it to files a seed actually
reads — a stray 827 KB spreadsheet that nothing imported lived here for months. If a new
seed needs a hardcoded list, put it here as a `.ts` constant rather than inlining it into
the script, and add the row above.

## Update rules — when to touch what

| Change | Update |
|---|---|
| Add / rename / drop a column on a **Prisma model** | `bootstrap-seed.ts` — same commit as the schema change |
| Add a new **permission** | `lib/codeOwnedCatalog.ts` (definition — both bootstraps import it) + mirror the constant in `src/shared/lib/constants/permissions.ts` + the grant in `data/personal.local.json`. Apply to the DB with `pnpm seed:apply-permissions`, not a full seed. |
| Add a new role / pipeline / status / worker | `bootstrap-seed.ts` (generic) + `data/personal.local.json` (our config) |
| Add a new account group or default GL ledger | `bootstrap-seed.ts` |
| Add a new tax / payment method / business invariant | `bootstrap-seed.ts` |
| Add a new fixture data file | `prisma/seeds/data/<name>.ts`; document the consumer here |
| Hard-clean must remove a new non-bootstrap table | extend `TRANSACTION_TABLES` / `INVENTORY_MASTERS` / `DUMMY_CONFIG_TABLES` in `hard-clean.ts` |
| Data moves into bootstrap | **remove it from `INVENTORY_MASTERS` / `DUMMY_CONFIG_TABLES`** in `hard-clean.ts` — bootstrap data must survive a hard-clean |
| Add a config table (settings / master / org / RBAC / workflow / POS) | add it to `lib/personalSnapshot.ts` (`exportPersonal` + `importPersonal`) so the personal snapshot stays complete |

> **Schema-and-seed coupling rule:** any commit that changes `prisma/schema/*.prisma` must also update `bootstrap-seed.ts` in the same commit. It is now the single seed that describes the schema — if it drifts, a new install is broken and nobody finds out until go-live.

## The admin login

| Email | Role | Password |
|---|---|---|
| `admin@networkservice.in` | R1 Admin (seeded by **bootstrap**) | `admin123` |

Staff logins come from `data/personal.local.json` via `pnpm prisma db seed`. A user the
overlay *creates* gets the default password `changeme123` (reported in the run summary) —
change it after seeding. The old `tech@` / `front@` / `des@` demo logins are gone with the
`dummy-users` seed.

## Schema invariants enforced by seeds

- `Account.type` is **removed** — section type derives from `AccountGroup.type` (`ASSET | LIABILITY | INCOME | EXPENSE`). UI groups by `a.group?.type`.
- Stock-in-Hand `AccountGroup` is intentionally empty in bootstrap — closing-stock is computed dynamically, not stored.
- Phone/Email rows are owned by exactly one of `personId` / `companyId` (XOR CHECK constraint applied by bootstrap).

