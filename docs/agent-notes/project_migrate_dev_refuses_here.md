---
name: project_migrate_dev_refuses_here
description: prisma migrate dev --create-only refuses on the local copy (an applied migration was edited); write the SQL with migrate diff into a hand-named folder instead. Never run prisma format.
metadata: 
  type: project
  modified: 2026-09-20T00:41:50.977Z
---

`pnpm db:migrate:new` (= `prisma migrate dev --create-only`) stops with *"20260917140000_voucher_branch_required was modified after it was applied … We need to reset"* — the fix commit 68cdd193 edited that migration after the local copy had recorded it. A reset would wipe `abeersuite_dev`; never accept it.

**How to apply (worked 2026-09-20 for the HR tables):**
1. Edit `prisma/schema/*.prisma`, `pnpm exec prisma validate`, `pnpm exec prisma generate`.
2. `pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema --script` — the diff between the local DB and the schema is exactly the new SQL (`--from-url` no longer exists in Prisma 7).
3. Paste it into `prisma/migrations/<YYYYMMDDhhmmss>_<name>/migration.sql` with a header comment in the house style, then `pnpm db:migrate` (`migrate deploy` applies it fine — only `migrate dev` checks the old checksum).
4. Same-commit companions: `pnpm sync:tables` (after any hand `overrides`), `pnpm db:local-schema`.

**Never run `pnpm exec prisma format`:** it reformats every schema file (11 files, ~160 whitespace lines) and pollutes the diff; `git checkout --` the untouched files if it happens.
