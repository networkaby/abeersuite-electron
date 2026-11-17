# Automatic backup — how the schedule works, and how to switch it on

The days and times are edited in Settings → Backup & Restore and take effect on the
next tick. No commit, no redeploy.

The hours the shop picks are honoured by GitHub, not by Vercel: a Hobby cron runs
once a day at an approximate time, which cannot hit an hour somebody chose. GitHub
schedules are free, unlimited, and — the deciding argument — keep working when the
deployment does not.

But GitHub only *promises* hourly; it does not deliver hourly. Measured over two
weeks in September 2026, the tick arrived about **6 times a day, not 24**, at random
minutes. A chosen hour is therefore hit roughly one time in four, and 1 AM and 4 AM
were missed night after night. GitHub says as much itself — scheduled runs are
best-effort and dropped when the shared queue is busy.

So Vercel Cron is back, in the one role it is actually good at: **a nightly floor.**
`vercel.json` runs `/api/cron/backup` at `30 16 * * *` — 16:30 UTC, 10:00 PM IST, and
on Hobby anywhere in 9:30–10:30 PM IST. It takes no gate and no vote:

- It does **not** ask `/api/cron/backup-due`. It dumps every night, full stop.
- It **ignores the Settings on/off switch.** Switching automatic backup off in
  Settings stops the GitHub hours; it does not stop this. That is deliberate — the
  floor exists precisely so that a wrong tap, a broken config row or a dead gate
  cannot leave the business with no backup at all.
- It needs a **production deploy** to change. Unlike the GitHub hours, this schedule
  lives in the repo, so editing it means a commit and a `d_office` push.

- It runs **only on the deployment holding the office domain.** Two Vercel projects
  (two accounts, two remotes of this repo) run this code; whichever holds
  `office.networkservice.in` — `COMPANY_DETAILS.sites.office` — is production. The
  route compares `VERCEL_PROJECT_PRODUCTION_URL` with it and answers `skipped` on any
  other host, shop included, whether that project uses the same database or another.
  Unset (local, desktop) still backs up. Vercel fixes that variable per deployment,
  so **after moving the domain, redeploy both projects.**
- **One backup repo for both.** Set the same `GITHUB_REPO` and a token for it on both
  Vercel projects; the Dropbox secrets live in that repo only. The database comes
  from the app (`source_db_url`), so either repo would dump the right one — one repo
  just keeps one Dropbox log and one queue.

Read the whole thing as three layers: Vercel guarantees one dump a night, GitHub
adds the hours the shop asked for when its tick shows up, and the Sunday safety net
below covers the app being dead.

## How it works

`backup-scheduled.yml` fires hourly and asks the app whether this hour is one the
shop asked for:

```
hourly tick → GET /api/cron/backup-due → read BackupConfig
              ├ switched off, wrong day, wrong hour → skip (run ends in seconds)
              ├ already ran this hour                → skip
              └ otherwise                            → call backup.yml, dump as usual
```

Three deliberate choices:

- **The gate fails closed.** If the app cannot be reached, the hour is skipped.
  Failing open would turn one outage into 24 full dumps a day, which is worse than
  the missed backups.
- **Because it fails closed, there is a safety net.** A second cron
  (`30 16 * * 0`, Sunday 22:00 IST) bypasses the gate entirely. With the app dead
  for a month the worst case is four backups, not zero — which is the whole reason
  scheduling lives on GitHub rather than in the app.
- **`lastRunAt` is stamped when the gate says yes**, not when the dump finishes.
  A late or retried tick in the same hour then cannot produce a second dump.

Everything is stored and compared in IST. Monday 00:30 IST is Sunday 19:00 UTC, so
comparing in UTC would put a Monday backup on Sunday.

## Switching it on

1. **Create the table** (once):
   ```bash
   pnpm prisma db push && pnpm prisma db seed
   ```
   Defaults to every day at 10 PM IST. The seed creates the row if it is missing
   and never touches it again, so this is safe on live and safe to re-run — the
   schedule is then edited from Settings → Backup & Restore, not from a script.
   (There used to be a dedicated `apply-backup-config.ts` for this step; the row
   is now part of the code-owned catalog every seed applies, so that script is
   gone — see [seeds.md](seeds.md).)

2. **Add two repo secrets** at Settings → Secrets and variables → Actions:

   | Secret | Value | Why |
   |---|---|---|
   | `APP_BASE_URL` | `https://office.networkservice.in` | where the tick asks. Unset = every gated hour skips, leaving only the Sunday run |
   | `CRON_SECRET` | **optional** — same value as the Vercel env var, if you set one | locks the endpoint down. Leave it unset on both sides and the check is skipped; set it on only one side and every gated hour 401s |

   `DIRECT_DATABASE_URL` must already be set, holding the **direct** URL — port 5432,
   no `pgbouncer=true`. The pooled URL makes `pg_dump` write a 0-byte dump.

   **On `CRON_SECRET` specifically.** It is optional by design, and blank counts as
   absent. Requiring it would mean a missing variable on either side silently stops
   every backup, and that failure looks identical to the app being down — a worse
   outcome than an open endpoint. The trade-off to understand: with no secret,
   anyone who knows the URL can trigger a backup, or hammer `/api/cron/backup-due`
   to stamp `lastRunAt` and thereby suppress a real one. Set it on **both** sides or
   **neither**; one side alone is the only broken combination.

3. **Push.** GitHub only runs schedules from the default branch, and only from the
   pushed file.

4. **Verify.** Set an hour a few minutes ahead, wait for the tick, and check the
   Actions tab: a skipped run says why in the gate step's log, a due one calls
   `backup.yml`. Then confirm the dump reaches Dropbox.

## What is where

| Piece | File |
|---|---|
| The rule | `src/shared/lib/backup/schedule.ts` — `isDue()` |
| Asked by the tick | `src/app/api/cron/backup-due/route.ts` |
| Read/write from the UI | `src/app/api/settings/backup/schedule/route.ts` |
| On/off switch | `src/app/api/settings/backup/workflow/route.ts` — GitHub's enable/disable API |
| The card | `src/modules/settings/components/BackupScheduleCard.tsx` |
| The tick and the safety net | `.github/workflows/backup-scheduled.yml` |
| The nightly floor | `vercel.json` → `crons`, calling `src/app/api/cron/backup/route.ts` |
| The work | `.github/workflows/backup.yml` |

## Known rough edges

- **The off state lives in GitHub, not the repo.** `backup-scheduled.yml` keeps
  listing its crons while the workflow is disabled, so the file alone will tell you
  backups run when they may not. The settings page and the Actions tab are the truth.
- **Hours only.** The tick is hourly, so a minute field would be a promise the
  schedule cannot keep.
- **No retention.** Every run is a full dump and nothing deletes old ones. Worth
  solving before the database grows.
- **GitHub disables schedules after 60 days without a push.** The settings page
  surfaces this as its own reason; turning the switch back on fixes it.

- **The GitHub hours and the Sunday net dump one database only** — the
  `DIRECT_DATABASE_URL` repo secret, never the app's URL. With two Vercel projects on
  different databases they cover only that one. Kept as they are, pending the
  owner's decision to use or remove them (2026-10-24).

## Keep sending the database URL

The app sends its own `DIRECT_URL` (else the cleaned `DATABASE_URL`) with every
manual and Vercel-cron backup, in the block both backup routes mark `KEEP THIS
BLOCK`. This used to be a temporary measure to comment out in production; it is now
the design. Two Vercel projects share one backup repo and may each use a different
database, and only the app knows which one it uses — without the block the runner
dumps whatever `DIRECT_DATABASE_URL` points at. A credential rotation also needs no
repo change.

The cost, accepted: `source_db_url` is a workflow **input**, and GitHub echoes inputs
in full in the job's env group. Secrets are masked; inputs are not, so every
app-triggered run prints the password in its log. Keep the backup repo private.

The workflow still falls back to the secret and builds the file name itself when no
input arrives (the GitHub-scheduled runs); both name generators produce
byte-identical names, and the project ref in the name says which database a dump holds.

Restore is different: the operator types the target database, so its URL travels
as an input too. `restore.yml`'s first step reads it from the event file and masks it
(and its password) before anything else runs, so it shows as `***` in every log line.


## Two databases: primary + staging (DB1 / DB2)

Set `DATABASE_URL_1` / `DIRECT_URL_1` and `DATABASE_URL_2` / `DIRECT_URL_2` on Vercel (without the `_1` names DB1 is `DATABASE_URL` / `DIRECT_URL`). Deploy migrations run on the primary (`scripts/migrate-primary.mjs`). From then on:

- **Every backup dumps the primary**, whichever of DB1 / DB2 that is today — the app passes its URL, never the `DIRECT_DATABASE_URL` secret, except on the Sunday safety net or a hand-started run of `backup-scheduled.yml` (those still use the secret; after a switch, update it or it dumps staging).
- **The app's nightly backup also copies into staging.** `/api/cron/backup` passes `staging_db_url` + `staging_name`; `backup.yml` restores the same dump into staging, keeps staging read-only (`default_transaction_read_only = on`) around the restore, and calls `POST /api/cron/db-copied` (`APP_BASE_URL` + `CRON_SECRET` secrets). The hourly gate now asks `/api/cron/backup` to dispatch, so a GitHub-timed backup copies too.
- **Switch window:** after a successful copy until the next 08:00 IST, once per copy. Settings → Backup & Restore → Databases, type SWITCH. The server also refuses if any table differs between the two (row count or latest `updatedAt`).
- After a switch: the old primary is read-only staging; counters pick up the new primary at their next start (restart any left open overnight).
- The staging URL is a workflow input today (masked in the log by the first step). Moving both URLs to GitHub secrets is planned.
