---
name: project_backup_secret_masking_deferred
description: Backup secrets stay duplicated in Vercel and git until production DB/hosting settle; the log-masking fix is deferred by owner's call 2026-09-20.
metadata:
  type: project
---

Owner's call, 2026-09-20: leave backup credentials duplicated in both Vercel and
the GitHub repo secrets for now, and revisit once the production database and
hosting are settled and no longer changing often.

The deferred work: `/api/cron/backup` and `/api/settings/backup` send the DB URL
to `backup.yml` as a workflow **input**, and GitHub masks secrets but not inputs.
Today it prints `***` only because Vercel's `DIRECT_URL` and the repo's
`DIRECT_DATABASE_URL` hold the same string, so the secret's masker covers the
input by accident. Rotate one side, or delete the repo secret, and the password
appears in the run log in full. The fix is ~10 lines: read the payload from
`$GITHUB_EVENT_PATH` with jq, `::add-mask::` each value, export via `$GITHUB_ENV`
— never through `${{ }}`, which is what echoes it.

Why it matters beyond the log: `DROPBOX_*` must live on Vercel regardless (the
app lists backups for the restore picker) and `DIRECT_URL` must too (Prisma), so
"secrets only in git" is not actually available. Only Vercel-supplies-them gives
one copy. `DROPBOX_FOLDER` drifting between the two is the disaster case — the
runner would upload to one folder while the restore picker lists another.

**Why:** owner does not want churn on credentials that are still moving.
**How to apply:** do not re-propose the masking work until production DB and
hosting are fixed; when doing it, keep repo-secret fallbacks so the GitHub
schedule keeps working. See [project_vercel_nightly_backup_floor](project_vercel_nightly_backup_floor.md).
