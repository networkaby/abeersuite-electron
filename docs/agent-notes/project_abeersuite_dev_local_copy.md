---
name: project_abeersuite_dev_local_copy
description: "abeersuite_dev is a local pg_restore copy of live Supabase taken 2026-09-20, schema current at all 10 migrations; the older local copies are stale."
metadata:
  type: project
---

`abeersuite_dev` on local Postgres is a **full copy of the live Supabase books**, dumped
2026-09-20 and verified row-for-row against live (119 tables, 3763 vouchers, 3702 persons,
1467 products, 13976 GL lines). `prisma migrate status` says up to date — all 10 migrations.

The other local databases are older and **not** current:
`abeersuite_audit` (7 migrations behind), `abeersuite_migrate`, `abeersuite_migrate-v1`
(the Vyapar clean room — see [project_vyapar_migration](project_vyapar_migration.md)), `abeersuite_dumpread`,
`abeersuite_dumpref`.

**Why:** developing against a stale schema fails on anything touching bank statements,
counter PIN, product opening branch or the now-required voucher branch.

**How to apply:** refresh it the same way when it goes stale —
`pg_dump` the URL stored as `COMPARE_DB_1` in `.env.local` (that IS the live direct URL, so the
password never needs typing), `--format=custom --schema=public`, then `pg_restore --no-owner
--no-privileges` into a fresh database. It holds real customer data. See
[project_local_postgres_on_d_drive](project_local_postgres_on_d_drive.md) for the binaries.
