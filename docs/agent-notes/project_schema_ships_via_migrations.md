---
name: project-schema-ships-via-migrations
description: Schema changes ship as committed Prisma migrations again (since 2026-09-13); every pre-existing database needs the 0_init baseline once.
metadata:
  type: project
---

Schema changes ship as **committed Prisma migrations** again — `prisma/migrations/`, documented in `docs/migrations.md`. This replaced the `db push` workflow on 2026-09-13, when moving the POS shift link onto `UniversalVoucher.sourceShiftId` needed to *carry data* that `db push` would have dropped.

`prisma.config.ts` must keep `migrations.path: "prisma/migrations"` — with a schema FOLDER, Prisma otherwise finds no migrations and says so misleadingly.

**Why:** `db push` re-derives each deployment's change, so nothing can be reviewed before it hits live and an offline counter has no ordered list to catch up on.

**How to apply:**
- Every database that existed before 2026-09-13 runs `pnpm db:migrate:baseline` **once** (marks `0_init` applied, changes nothing). Only the local dev DB has had it so far — live and the counters are still pending, the owner runs those.
- Then `pnpm db:migrate`. `pnpm db:migrate:new` writes SQL without running it, for hand-editing a data move.
- An enum value needs its own migration file: Postgres will not let a value be used in the transaction that adds it.
- `resources/local-schema.sql` and `prisma/sync-tables.json` are still generated from the schema, not from migrations, and still need regenerating. `local-schema.sql` cannot express a DROP, so a retired table stays behind, empty, on replicas built before the change.

Related: [project_worktree_cannot_be_browser_verified](project_worktree_cannot_be_browser_verified.md), [project_db_probing_via_dev_server](project_db_probing_via_dev_server.md)
