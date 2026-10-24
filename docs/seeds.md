# Seeds

All seed scripts and their fixture data live under `prisma/seeds/`.

```
prisma/seeds/
├─ bootstrap-seed.ts            GENERIC — new-client installer (run via `pnpm seed:generic`)
├─ export-personal.ts           PERSONAL — reverse-create YOUR config snapshot from the live DB
├─ personal-bootstrap.ts        PERSONAL — what `pnpm prisma db seed` runs: code-owned catalog + your snapshot (self-complete)
├─ helper-brands.ts             HELPER — trade-specific brand master (InvBrand)
├─ apply-taxonomy.ts            APPLY — classify group + brand on the real catalog from product names (`--dry` previews)
├─ sync-permissions.ts          APPLY — bring Permission rows in line with the catalog + grant one to roles, without a full seed
├─ hard-clean.ts                CLEANER — wipes everything bootstrap doesn't seed
├─ purge-vouchers.ts            OPS — wipes only vouchers/JEs/invoices/payments
├─ purge-demo-contacts.ts       OPS — wipes contacts (+ transactions), keeps products + settings
├─ purge-demo-products.ts       OPS — wipes products (+ transactions), keeps contacts + settings
├─ recompute-balances.ts        OPS — recompute Account.balance drift from JournalLine
├─ lib/
│  ├─ purgeDemo.ts       SHARED — transaction table list + purge steps for the demo cleaners
│  ├─ assertNotCounter.ts SHARED — refuse to run a destructive seed against a counter machine
│  ├─ positionSeedSync.ts SHARED — upsert a position + its role-template links
│  ├─ codeOwnedCatalog.ts SHARED — code-owned data both bootstraps use: XOR CHECK constraints, voucher series, and a re-export of the permission catalog. ADD NEW PERMISSIONS in src/shared/lib/auth/permissionCatalog.ts (the app reads it too).
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

## `bootstrap-seed.ts` — OUR installer, not a generic one

Runs via `pnpm seed:generic`. **It describes this company's real setup**, captured
from the live database — the workflow we run, our roles, our couriers, our
gateways. It is no longer a generic demo world, and it is no longer "starter
values someone should tune later".

> **The live DB is the source of truth for this file.** Configure in the UI first,
> then mirror the change back into `bootstrap-seed.ts` in the same commit. A
> code-owned *generic* installer for the public build is a separate, later job.

Idempotent, and every write is create-only where an admin can edit the value, so
a re-run never overwrites tuned settings. It seeds:

- **RBAC** — **3 roles**: `R1` Role-Admin (the only `isSystem` role, homed in the all-access `DEP-ADMIN`), `R2` Branch Manager (`DEP-OP`), `R3` Counter Operator (`DEP-SALES`). Their **grants are not seeded here** — those are config and live in the personal snapshot; bootstrap only guarantees the rows and their department homes. Plus 130+ permissions, including a **per-kind voucher gate** for every hand-created voucher kind (GL `finance:voucher:<action>:<kind>`, inventory `inventory:voucher:<action>:<kind>`) generated from `src/shared/lib/auth/voucherMatrix.ts` so the mapping never drifts.
- **Workflow** — 9 pipelines, 61 ticket statuses, 5 work groups, 48 status transitions. **No works and no ticket workers** (see below).
- **Couriers** — our 6 real delivery methods, including Local delivery's per-neighbourhood pricing for the pincodes we serve (783384 Abhayapuri / Lengtisinga, 783380 Barpara), INDIA POST zone rates, and the Shiprocket / Shipway pickup pincode.
- **Payment** — 4 gateways (Pay-on-delivery, Razorpay, PayU, Cashfree), each linked to its settlement ledger **by name**, plus the `Payment Gateway` account group and those four ledgers.
- **Org structure** — 1 branch (HQ, **branch number 9** — it prefixes voucher numbers, so this must not change), 9 cross-branch departments incl. the all-access `DEP-ADMIN`. Departments are seeded in the RBAC section because `Role.departmentId` is a required FK needing `DEP-ADMIN` first.
- **Chart of accounts** — AccountGroups (Tally tree) + GL ledgers; per-branch Vault accounts + POS counter till accounts
- **Inventory masters** — units, warranty terms, GST slabs
- **Org Defaults** — default GST rate, unit, taxability, currency, credit periods
- **DB constraints** — `Phone_owner_xor`, `Email_owner_xor` CHECK constraints (Prisma can't express XOR; raw SQL inside the seed)

> **Works and TicketWorkers are deliberately not seeded.** The live DB has **zero**
> rows in `Work`, `WorkGroupWork`, `TicketWorker` and `WorkerTransition`, and no
> status carries a `startWorkerId` — the board runs on statuses alone. This file
> used to seed 9 works and 43 workers that nothing used, so every reseed rebuilt an
> automation layer staff had already abandoned. The 5 **work groups** are real and
> stay. If workers are adopted later, build them in the UI and mirror them back.

> **`helper-roles.ts` is deleted.** It was a new-client starter set that upserted
> `R2` as "Role-Service Engineer" and `R3` as "Role-Counter / Cashier" in other
> departments, and rewrote their grants on every run — so running it would have
> renamed two live roles and replaced permissions real staff depend on. Bootstrap
> now carries the real `R2` / `R3` rows and the snapshot carries their grants.

## Personal bootstrap — self-complete restore of YOUR install

The personal bootstrap does **not** run the generic installer. It stands up a
working install from two sources and nothing else:

1. **Code-owned catalog** (`lib/codeOwnedCatalog.ts`, permission list in `src/shared/lib/auth/permissionCatalog.ts`) — the permission catalog
   (upsert + prune of retired ids), the Phone/Email XOR CHECK constraints, the
   voucher numbering series, and the **existence** of the `BackupConfig` row.
   The things the snapshot deliberately never carries because they belong to
   the code.
2. **Your snapshot** (`data/personal.local.json`) — every piece of real config.
3. **R1 top-up** — R1 (Admin) is granted any catalog permission it doesn't
   already hold, so code-added permissions reach the admin role without waiting
   for a re-capture.

> **`BackupConfig` is split on purpose, and the split is the whole point.**
> `/api/cron/backup-due` reads that row every hour to decide whether a backup is
> due, so **a missing row means no backups, silently** — the failure says nothing
> about itself until the day you need a restore. The *schedule* is your config and
> rides the snapshot like any other setting; the *row existing at all* is a code
> invariant, created in step 1 with the schema defaults (every weekday, hour 22 —
> daily 10 PM IST). Step 1 runs **before** the snapshot overlay and before the
> no-snapshot early return, so a fresh DB is covered whether or not a capture has
> happened yet; step 2 then puts your real schedule back. Both halves are
> create-only, so an admin's edit in Settings → Backup & Restore always survives.
> (The old `apply-backup-config.ts`, which used to be the only thing that made this
> row, is deleted — it is now redundant on every path except `--overlay-only`.)

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
| Config singletons — `OrgDefaults`, `InvNamingConfig`, `LoyaltyConfig`, `CouponConfig`, `CreditLimitConfig`, `BooksConfig`, `BiGstPlanningConfig`, `OfflinePolicy`, `BackupConfig` (schedule only — `lastRunAt` is runtime state and is never exported) | `Ticket*` (tickets) |
| Inventory/tax masters — `GstRate`, `InvUnit`, `InvWarrantyTerm`, `InvCategory`, `InvProductGroup`, `InvBrand`, `InvAttributeMaster`, `StrategyPoint`, `VoucherPrintTemplate` | `UniversalVoucher*` / journal / invoice / payment / stock-ledger (vouchers) |
| Chart of accounts — `AccountGroup` + `Account` (+ its `AccountAlias` rows) **(GL ledgers only)** | `Person` / `Company` / `Phone` / `Email` / party ledgers (customers) |
| Spend-tier ladders — `CustomerTierPeriod` + `CustomerTier` | `InvProduct*` (products) |
| Org structure — `Branch`, `Department` | `Coupon` / `GiftCard` / `LoyaltyEarnRule` / `LoyaltyMilestone` (entangle products + customers — only the **config singletons** above are kept) |
| RBAC — `Role`, `RolePermission`, `DepartmentPermission`, `Position`, `PositionRole`, staff `User` + `UserPosition` / `UserPermission` (Permission rows themselves stay code-owned — `src/shared/lib/auth/permissionCatalog.ts`) | |
| POS setup — `PaymentGateway`, `PosCounter`, `PosCounterPaymentAccount`, `PosService` | |
| Repair pipeline — `Pipeline`, `WorkGroup`, `Work`, `TicketStatus`, `TicketWorker`, status + worker transitions | |

**How it stays portable.** The RBAC / org / pipeline layers use human-assigned
**string ids** (`R1`, `DEP-ADMIN`, `PIPE-REPAIR` …) that survive a reseed
unchanged, so their rows and join tables port by id. The Int-autoincrement
models (accounts, GST, units, categories, counters, gateways) are referenced
across the snapshot by their **natural key** (account name, GST label,
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

## Categories and product groups — where they come from

**`helper-inventory-masters.ts` is deleted.** It seeded a taxonomy this business
never adopted. Of the 77 names it declared, exactly **one** ("Photo Paper") exists
in our tree — it spoke of "Computer Mice", "Memory (RAM)", "Surveillance Cameras",
"Desktop Systems", where we run "Mouse", "RAM", "HD Dome", "Desktop & CPU". Its
categories (Laptops / Desktops / Printers / …) had **zero** overlap with ours
(Retails Solution, Professional & Office, Small Business, Home Security, Industrial
security system, IT Products), which are a merchandising axis, not a parts list.

Running it would have created **~76 duplicate groups** beside our real 102 — a
second parallel tree, straight into the live catalogue with nothing to isolate it.
Nothing would have stopped it either: `@@unique([name])` never trips, because the
names differ. (It would *not* have corrupted tax data — measured against live, only
2 rows matched and both merely gained an HSN code, with 0 GST changes.)

Our real taxonomy — **6 categories, 102 groups** — was built by `apply-taxonomy`
and then curated by hand, so it is **config, not a generic master**. It lives in
`data/personal.local.json` and is applied by `pnpm prisma db seed`.

| Master | Restored by |
|---|---|
| `InvBrand` | `pnpm seed:helper-brands` |
| `InvCategory`, `InvProductGroup` | `pnpm prisma db seed` (personal snapshot) |

> Because these live only in the snapshot and not in `bootstrap-seed.ts`, they are
> one more reason `personal-bootstrap` cannot retire yet.

## Roles — where they come from

**`helper-roles.ts` is deleted.** It created `R2`–`R7` (Service Engineer,
Counter/Cashier, Stores & Despatch, Branch Manager, Accountant, Sales Executive)
for a brand-new client of this trade — and it was unsafe here, for the same reason
`helper-inventory-masters` was: it described a different business using **our ids**.

We run `R2` = **Branch Manager** (`DEP-OP`) and `R3` = **Counter Operator**
(`DEP-SALES`). The helper upserted those same two ids with different labels, in
different departments, and **rewrote their grants on every run** — so a single run
would have renamed two live roles, re-homed them, and replaced the permissions real
staff depend on.

| Layer | Comes from |
|---|---|
| The `R1` / `R2` / `R3` **rows** and their department homes | `bootstrap-seed.ts` (captured from live) |
| `R1`'s grants | `bootstrap-seed.ts` — every non-`systemOnly` permission |
| `R2` / `R3` grants, and **department permission pools** (241 rows) | `data/personal.local.json`, via `pnpm prisma db seed` |

Department pools matter because a role can never grant outside its department's
pool — except the all-access `DEP-ADMIN`, which carries no rows because its pool is
everything.

## Targeted appliers — a small change without a full seed

Manual, idempotent, **never** auto-run by Prisma. A full `pnpm prisma db seed` re-touches
every master and prunes — wasteful and risky on live when a change only ADDS a few rows.
These do just the one job.

| Script | Purpose |
|---|---|
| `pnpm seed:apply-taxonomy` | Fills `group` + `brand` on the **real** catalog by matching product names. Two-pass (head-noun first, then anywhere) and only ever fills NULLs, so manual corrections survive. `--dry` previews. Re-run after a bulk import — see the note below. |
| `pnpm seed:sync-permissions` | Creates the `Permission` rows the code-owned catalog has and the DB does not, and grants one to named roles (`--roles`) or takes it back (`--revoke-from`). **Dry by default — `--apply` writes.** Never deletes a `Permission`; a DB row absent from the catalog is reported and left alone. Carries no permission list of its own (it imports `PERMISSION_CATALOG`), so it cannot drift. Use it when a new `ui:sidebar:*` id appears and you do NOT want the R1 top-up a full seed brings. |

### Shipping a permission

There is **no `apply-permissions` script any more.** It existed to write a handful of
rows without a full seed, but every row it wrote was already in
`src/shared/lib/auth/permissionCatalog.ts` (re-exported by `lib/codeOwnedCatalog.ts`), and **both** seeds apply that catalog in full with the
identical upsert (`bootstrap-seed.ts` line ~865, and `applyCodeOwnedCatalog()` for
`pnpm prisma db seed`). Its `ADDITIONS` list had become a third copy of the same
data, guarded by nothing, and all 12 entries were finished work.

The flow is now:

1. Add the permission to `src/shared/lib/auth/permissionCatalog.ts` **and** mirror the constant in
   `src/shared/lib/constants/permissions.ts` (`pnpm seed:check-docs` enforces that
   these two agree).
2. `pnpm prisma db seed`.

> **A full seed does one thing the old script did not: the R1 top-up.** Step 3 of
> `personal-bootstrap.ts` grants R1 every non-`systemOnly` permission in the catalog.
> R1 currently holds 177 of 286, so the next reseed will add roughly 108 grants — and
> if a permission was deliberately removed from R1 in the Role Matrix, it comes back.
> Decide which you want before reseeding. (`admin:bypass` is `systemOnly` and stays
> excluded.)

**Some permissions are never typed by hand.** Adding a nav entry to `SETTINGS_NAV` /
`MODULE_SECTIONS` makes `sidebarModules.ts` derive a new `ui:sidebar:<module>:<link>` id,
which `permissionCatalog.ts` folds into the catalog automatically. The row is then real in
code and absent from every database. **Since 2026-09-20 that is fine on its own:** the
Departments pool save and the Role save both call `ensureCatalogPermissions()`
(`src/shared/lib/auth/ensurePermissions.ts`) first, which creates any code-known row the DB
lacks. And a department pools a sidebar module as a **whole** — `getDepartmentPool()` expands
"any link of the module stored" to every current link from code — so a page added to a
module the department already has is offered on the Role page straight away, with the
module chip still ticked. Nothing to run after adding a nav link; just tick it per role.

When you want the row created ahead of any save, or granted to roles in bulk, the
targeted applier is still there:

```bash
pnpm seed:sync-permissions --grant ui:sidebar:settings:screen-size --roles R1          # preview
pnpm seed:sync-permissions --grant ui:sidebar:settings:screen-size --roles R1 --apply  # write
```

Changed your mind about who holds it? `--revoke-from` is the symmetric twin, and takes
back only that one permission from only those roles:

```bash
pnpm seed:sync-permissions --grant ui:sidebar:settings:screen-size --revoke-from R2,R3 --apply
```

The R1 top-up on its own, without a full seed — every non-`systemOnly` catalog permission
the role lacks (lower CRUD rungs implied by a held higher one are skipped). It adds only,
so anything deliberately taken away comes back: read the dry-run list first.

```bash
pnpm seed:sync-permissions --grant-missing --roles R1                       # preview
pnpm seed:sync-permissions --grant-missing --roles R1 --apply --no-revoke   # write
```

It creates only the rows the catalog has and the DB lacks, grants them, and bumps
`tokensValidFrom` for the affected staff (permissions ride the JWT, so a grant is invisible
until the holder signs in again). Pass `--no-revoke` during trading hours — the grant still
lands, it just waits for each person's next login. `--overlay-only` on the full seed is **not**
an alternative: the R1 top-up sits outside that branch and runs anyway, and skipping step 1
means the new row is never created.

### `apply-taxonomy` and the group tree

It is the only thing that classifies **products** — `bootstrap-seed.ts` and the
personal snapshot both exclude products entirely, so nothing else does this job.

**Brands are read live from `InvBrand`.** There is no brand list in the script. To
match more products, add the brand in the app (or `helper-brands.ts`) and re-run.

**Brand matching is separator-flexible.** The catalogue and the brand master disagree
about punctuation constantly, and a literal `\bD-Link\b` matches none of these:

| Product name says | Brand row is |
|---|---|
| `Dlink`, `D Link` | `D-Link` |
| `M.SKILL`, `M.Skill` | `M Skill` |
| `TP Link` | `TP-Link` |
| `Dish TV` | `DishTV` |

So each brand becomes a pattern where any run of space / dot / hyphen / underscore
can stand in for a separator the brand name has, including the seam in a CamelCase
name. **The `\b` word boundaries are kept on purpose** — fully normalising both sides
would make short brands catastrophic (`HP` would match inside "graph paper"). Do not
widen this to a bare `includes`.

**Genuine misspellings** are a separate, short, hand-reviewed `BRAND_ALIASES` map in
the script (`Kingstone → Kingston`). A brand row that is itself a known misspelling is
excluded as a match target, so a junk row can never beat the real brand.

> ⚠️ **Never add an alias on similarity alone.** `Intel`, `Intex` and `Itel` are one
> character apart and are three real, different companies. Fuzzy distance is for
> *suggesting* a merge to a human, never for deciding one.

**The group tree is not the script's to reshape.** Its hardcoded `TREE` is a sketch
and is already behind the live tree (78 groups vs 100 live), so it gets no authority
over a structure the owner maintains by hand:

- a group the script **creates** is filed under **`auto-created-group`**, flat —
  never straight into the live tree. Review it in Settings, drag it where it
  belongs, delete what you don't want. Parked there it inherits no HSN/GST, which
  is deliberate: it reads as unconfigured until a human files it.
- an **existing** group sitting outside its `TREE` position is reported and **left
  alone**. It used to be silently re-parented, which rearranged a live catalogue on
  the strength of a stale list. `--adopt-strays` opts back in for one run.

The quarantine parent is created lazily — a run that creates nothing leaves no
empty group behind.

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
- ShopCoupon, PortalCredentials
- Payment gateways (`payment_gateways`, Settings → Payment Methods — operator config, bootstrap seeds none). Cleared with an explicit `DELETE` (not a `TRUNCATE … CASCADE`) so the `ON DELETE SET NULL` on `PosCounterPaymentAccount.gatewayId` fires: counter payment rails are **preserved**, just unlinked from the deleted gateways.
- **Non-system roles** (every `Role` with `isSystem: false` — our `R2` Branch Manager, `R3` Counter Operator, and any admin-created role). Positions pointing at them are unlinked first (restrict FK), then the roles + their grants are deleted. `R1` (the only `isSystem` role) survives. Restore with `pnpm prisma db seed`: bootstrap re-creates the `R2` / `R3` rows, the snapshot restores their grants.
- **Department permission pools** (`DepartmentPermission`) — config, not bootstrap (bootstrap seeds none; `DEP-ADMIN` is all-access with no rows), so they are cleared. Department rows themselves are bootstrap-seeded and survive. `pnpm prisma db seed` restores our 241 pool rows from the snapshot.

**Preserves** everything bootstrap-seed wrote, plus user-set config:
- `R1` role + Permissions + R1's RolePermissions, Pipelines, Statuses, Branches, Departments
- Chart of accounts (AccountGroup tree + GL ledgers)
- **InvUnit** (13 units) — universal bootstrap data
- **InvWarrantyTerm** (~10 terms) — universal bootstrap data
- OrgDefaults singleton, InvNamingConfig singleton, CreditLimitConfig singleton
- Account opening balances, CompanySettings

> **Destructive.** Vouchers + customers + products are unrecoverable. Use only in dev.

After cleaning, restore with `pnpm seed:helper-brands` (the brand master) and
`pnpm prisma db seed` (roles, grants, department pools, categories, product groups,
and the rest of the config). There is no demo data to repopulate; contacts and
products are re-entered through the UI or the CSV importers.

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

**Both preserve** (the difference from `hard-clean`): all Users, all Roles + grants (including non-system / admin-edited ones), `DepartmentPermission` pools, `payment_gateways` + POS counters + counter rails, **InvBrand / InvCategory / InvProductGroup / InvAttributeMaster**, Coupon + Loyalty config masters, and Chat + WallPost (staff-only — they FK to `User`, never to a party or product). Everything bootstrap seeds survives as usual.

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
| Add a new **permission** | `src/shared/lib/auth/permissionCatalog.ts` (definition — both seeds and the app import it) + mirror the constant in `src/shared/lib/constants/permissions.ts` + the grant in `data/personal.local.json`. Apply with `pnpm prisma db seed` — see "Shipping a permission" above, including what the R1 top-up does. |
| Add a new role / pipeline / status / worker | `bootstrap-seed.ts` (generic) + `data/personal.local.json` (our config) |
| Add a new account group or default GL ledger | `bootstrap-seed.ts` |
| Add a new tax / payment method / business invariant | `bootstrap-seed.ts` |
| Add a new fixture data file | `prisma/seeds/data/<name>.ts`; document the consumer here |
| Hard-clean must remove a new non-bootstrap table | extend `TRANSACTION_TABLES` / `INVENTORY_MASTERS` / `DUMMY_CONFIG_TABLES` in `hard-clean.ts` |
| Data moves into bootstrap | **remove it from `INVENTORY_MASTERS` / `DUMMY_CONFIG_TABLES`** in `hard-clean.ts` — bootstrap data must survive a hard-clean |
| Add a config table (settings / master / org / RBAC / workflow / POS) | add it to `lib/personalSnapshot.ts` (`exportPersonal` + `importPersonal`) so the personal snapshot stays complete |
| HR & People (`StaffProfile`, `StaffSalary`) | captured in full as `staffProfiles` / `staffSalaries` (user by email, ledgers by name) — the owner's 2026-09-20 call is no exclusions; a snapshot older than version 3 simply carries none and seeds none |

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

