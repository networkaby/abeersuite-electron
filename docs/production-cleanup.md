# Production clean-up list

Things deliberately left in a development-friendly state. Each one is safe now and
wrong in production. Work through this at the production-start commit, and delete
each item as it is done rather than ticking it — a list of ticks stops being read.

Ordered by what hurts most if forgotten.

## 1. Rotate the Supabase database password

**Why:** it is sitting in plaintext in several GitHub Actions run logs. `source_db_url`
is a workflow *input*, and GitHub echoes inputs in full in the job's env group —
secrets are masked, inputs are not. Anyone with read access to Actions can read it.

**Do:** rotate it in Supabase, update `DIRECT_URL` and `DATABASE_URL` in Vercel and
in `.env.local`, update the `DIRECT_DATABASE_URL` repo secret, then delete the old
runs (`gh run delete <id>`) or accept that the old password is burned.

The app still sends the URL (item 2 was dropped), so the new password will show in
new backup run logs as well — keep the backup repo private.

## 2. ~~Stop sending the database URL from the app~~ — dropped (2026-10-24)

**Do not do this.** Two Vercel projects share one backup repo and may each use a
different database; the URL the app sends is how the runner knows which one to dump.
Both backup routes now mark the block `KEEP THIS BLOCK`. The password-in-log cost is
accepted — keep the backup repo private. See
[backup-schedule-activation.md](backup-schedule-activation.md#keep-sending-the-database-url).

## 3. Lock down the LAN bind

**Why:** the dev server binds `0.0.0.0` so shop machines can reach it. That is a
development convenience, not a production posture.

**Do:** bind to localhost, or put it behind the reverse proxy that terminates TLS.

## 4. Set `CRON_SECRET` on both sides, or neither

**Why:** `/api/cron/backup` and `/api/cron/backup-due` skip their auth check entirely
when the variable is absent. Open, anyone who knows the URL can trigger a backup — or
hammer `backup-due` to stamp `lastRunAt` and thereby *suppress* a real one.

**Do:** set the same value in the Vercel env and the GitHub Actions secret. It is
already in `.env.local` and in the repo secret; Vercel is the missing side. Setting it
on the app side alone is the one broken combination — every gated hour then 401s and
only the Sunday safety-net backup runs.

## 5. Decide the dump retention policy

**Why:** every backup is a full `pg_dump` and **nothing ever deletes one**. At five a
day that is 150 files a month. Dropbox fills, and Supabase egress is metered — the
dump is compressed *after* leaving the database, so a 1 MB file is 5–10 MB of egress.

**Do:** either a retention step in `backup.yml` (delete dumps older than N days), or
a decision to prune by hand. Also revisit the schedule: five a day of a
slowly-changing database is five nearly identical copies.

## 6. Fix the `Type check` CI failure

**Why:** it has been red since 2026-08-23, so it protects nothing and everyone has
learned to ignore it. It is an out-of-memory, not a real type error — `tsc` needs
more than the default ~2 GB heap on this codebase.

**Do:** set `NODE_OPTIONS=--max-old-space-size=8192` in `.github/workflows/typecheck.yml`.
Confirmed: it passes cleanly with that.

## 7. Remove the Sentry example routes

**Why:** `README.md` already flags them — test pages that should not ship.

## 8. Confirm what the settings toggle is actually doing

**Why:** the automatic-backup off state lives in **GitHub**, not in the repo.
`backup-scheduled.yml` keeps listing its cron times while the workflow is disabled, so
the file alone will tell you backups run when they may not.

**Do:** before go-live, check the Actions tab rather than the file, and make sure
whoever runs the shop knows the settings page is the source of truth.

## 9. Buy a code-signing certificate

**Why:** the installer is unsigned, so every shop PC shows a SmartScreen "unknown
publisher" warning that staff must click through. Teaching staff to click past that
warning is teaching them to install anything.

**Do:** buy an OV certificate before wide rollout and set `win.certificateFile` /
`certificatePassword` in `package.json`. Nothing in the repo configures signing today.

## 10. Decide three office pages: surface them or delete them

**Why:** they exist under `src/app/(protected)/office/` but no nav links to them, so
they are reachable only by typing the URL. Either is fine — being neither is what rots.

- `office/customers/dashboard` — customer analytics
- `office/accountancy/dashboard` — accountancy overview
- `office/inventory/configuration` — inventory master config (likely belongs under Settings)

**Do:** for each, add it to `src/shared/lib/constants/nav.ts` nav or delete the route.

## Not clean-up, but verify on the day

- Scheduled workflows only run from the **default branch**, and only from the pushed
  file. A schedule perfected on `sync` does nothing.
- GitHub **disables schedules after 60 days without a push**. If backups go quiet
  months from now, check that first — the settings page surfaces it as its own reason.
- The first real restore has never been rehearsed end to end. A backup nobody has
  restored from is a hypothesis, not a backup.
