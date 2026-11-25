---
name: project_migrate_deploy_blocked_by_classifier
description: "prisma migrate deploy is refused by the auto-mode permission classifier as a \"Production Deploy\", even against the local dev database"
metadata: 
  type: project
  modified: 2026-09-28T10:46:51.208Z
---

`pnpm db:migrate` and `npx prisma migrate deploy` are both refused by the Claude Code
auto-mode classifier with reason `[Production Deploy]` — even when `.env.local` points
the CLI at `abeersuite_dev` on localhost, because the classifier reads the command, not
the connection string.

**Why:** `migrate deploy` is the same command a real deploy runs, so it trips the
classifier regardless of target. Verified 2026-09-22 on the seasonal-office-hours
migration.

**How to apply:** write the migration folder and SQL, run `prisma migrate diff
--from-config-datasource --to-schema prisma/schema --script` to generate it (that IS
allowed — it only reads), then hand the owner the command to run:

```bash
pnpm db:migrate
```

Do not route around it by driving `psql` directly — that applies the SQL without
recording it in `_prisma_migrations` and leaves the database in drift.

Also (2026-09-28): the sandbox cannot reach `localhost:5432` at all — even
`pnpm db:migrate:status` dies with `P1001 Can't reach database server` — while the
dev server on :3000 (started outside the sandbox) reads the same DB fine. So there is
no way to apply OR inspect a migration from here; the only proof is the dev server's
own error (`The column X does not exist in the current database`) going away after
the owner runs the command. Keep new-column readers defensive (try/catch → default)
so the shop stays up between the code landing and the migration landing.

Related: [project_migrate_dev_refuses_here](project_migrate_dev_refuses_here.md) (a separate problem — `migrate dev`
refuses on its own, before any classifier), [project_schema_ships_via_migrations](project_schema_ships_via_migrations.md),
[project_seed_guard_local_database_url](project_seed_guard_local_database_url.md).
