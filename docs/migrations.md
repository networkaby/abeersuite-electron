# Migrations

From **2026-09-13** schema changes ship as committed Prisma migrations, not as a
bare `prisma db push`. `prisma/migrations/` is the history; the database records
what it has applied in `_prisma_migrations`.

## Why the change

`db push` compares the schema to the database and makes them match. It is fine
while a schema is being invented, and wrong once there is data in it, for two
reasons we hit for real:

- It cannot carry data. Moving the POS shift link off `pos_receipts` onto
  `UniversalVoucher.sourceShiftId` means *copying* every existing link before the
  old table goes. `db push` can only drop the table and lose it.
- It cannot be reviewed or replayed. Every deployment re-derives its own change,
  so nobody can read what will happen to live before it happens, and a counter
  that was offline has no ordered list to catch up on.

## The baseline

The repo ran on `db push` for a long time, so the first migration,
**`0_init`**, is the schema as it already stood on 2026-09-12 — generated from
the schema, never actually run against any existing database.

**Every database that already exists must be told it is already at that point,
once, before any later migration is applied:**

```bash
pnpm db:migrate:baseline
```

That writes a single `_prisma_migrations` row marking `0_init` as applied and
changes nothing else. Run it against demo, against live, and against any counter
replica that was provisioned before this date. A **brand new** database skips it
and just runs `pnpm db:migrate`, which applies `0_init` for real.

Getting this wrong is loud, not silent: without the baseline row Prisma tries to
create 116 tables that already exist and stops on the first one.

**`0_init` is frozen the moment any database records it.** Its checksum is stored
in that `_prisma_migrations` row, and editing the file makes `prisma migrate
deploy` refuse to run at all. That has a consequence worth knowing: `0_init` was
generated from the schema a little *after* 2026-09-12, so it already declares a
few things added just after that date — `Call."updatedAt"` is the first. A brand
new database therefore RUNS them as part of the baseline, while a baselined one
never does. **Any later migration touching something `0_init` already declares
must be idempotent** (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`),
or it breaks every fresh install. See
`prisma/migrations/20260913120000_call_updated_at/migration.sql`.

## Counters come before the server

A schema change reaches Supabase and each counter replica separately, and the
order is fixed: **release the counter build first, then run `pnpm db:migrate`.**

`sync-engine/lib/schemaGuard.js` halts a counter when the source has a column the
replica lacks — `SCHEMA DRIFT — refusing to sync`, `exit 4`, **every table on that
till, not just the changed one**. A column the replica has spare is harmless, so
build-first costs only an error on the one table until the migration lands, while
server-first stops the shop. `docs/commands.md` §0 and the release skill say the
same thing.

## Day-to-day

| Command | What it does |
|---|---|
| `pnpm db:migrate` | Apply every pending migration. This is the deploy command. |
| `pnpm db:migrate:status` | What is applied, what is pending, what has drifted. |
| `pnpm db:migrate:new` | Write a new migration from the schema **without** running it, so the SQL can be read and edited first. |
| `pnpm db:migrate:baseline` | One-time, per existing database — see above. |

**Writing one:** edit `prisma/schema/*.prisma`, then `pnpm db:migrate:new`,
then open the generated SQL and read it. Prisma writes structure only, so any
data move is yours to add by hand — and a migration that drops a table almost
always needs one. Put the data move *between* the `ADD` and the `DROP`, so the
whole change is one transaction that either lands or does not:

1. add the new column / table,
2. carry the data over,
3. drop the old one.

`prisma/migrations/20260913091000_voucher_source_shift/migration.sql` is the
worked example of exactly that shape.

**Adding a value to an enum needs its own migration file.** Postgres will not
let a value added to an enum be used in the same transaction that adds it, and
Prisma runs one migration per transaction. See the `ADVANCE_FOR` pair.

## What still uses the schema directly

- **`resources/local-schema.sql`** (`pnpm db:local-schema`) is a from-empty
  snapshot for creating a counter's replica, and stays that way — replaying a
  whole history on a fresh shop PC is slower and more fragile than one snapshot.
  It re-declares every column as `ADD COLUMN IF NOT EXISTS`, so an existing
  replica picks up new columns on upgrade. It cannot express a DROP: a table
  removed from the schema simply stays behind, empty and unread, on replicas
  provisioned before the change.
- **`prisma/sync-tables.json`** (`pnpm sync:tables`) is regenerated from the
  schema the same way. Both are checked by `pnpm precommit`.

## Seeds are not migrations

Seeds assert configuration (permissions, catalogs, masters) and are idempotent;
migrations change structure and carry data, and run exactly once each. A
permission or a chart-of-accounts entry belongs in a seed — see `docs/seeds.md`.
