# Automatic backup — how the schedule works, and how to switch it on

The days and times are edited in Settings → Backup & Restore and take effect on the
next tick. No commit, no redeploy.

This replaces an earlier design built on Vercel Cron. That is gone: Hobby crons run
once a day at an approximate time, which cannot honour an hour the shop picks.
GitHub schedules are free, unlimited, and — the deciding argument — keep working when
the deployment does not.

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
   pnpm prisma db push && pnpm tsx prisma/seeds/apply-backup-config.ts
   ```
   Defaults to every day at 10 PM IST.

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

## Production: stop sending the database URL

While database credentials rotate often, the app sends its own `DIRECT_URL` with
every manual and Vercel-cron backup. That keeps rotations free — the app always
holds the current one and no repo secret has to be updated.

It costs one thing: `source_db_url` is a workflow **input**, and GitHub echoes
inputs in full in the job's env group. Secrets are masked; inputs are not. So every
app-triggered run prints the password in its log.

Once the credentials settle, comment out one block in each of:

- `src/app/api/settings/backup/route.ts`
- `src/app/api/cron/backup/route.ts`

Each is marked `IN PRODUCTION, COMMENT OUT THIS BLOCK` and ends with
`end of block to comment out`. Nothing else changes — the workflow already prefers
the input and falls back to the secret, so removing the input is the whole switch.

No flag and no env var on purpose: a boolean would mean two live code paths forever,
and a deployment toggle for a one-time decision is a setting nobody remembers exists.
The app then sends **no URL and no file name**; the runner dumps whatever
`DIRECT_DATABASE_URL` points at and builds the name itself.

The name has to move to the runner because the secret may point at a **different
database** than the app uses. The app cannot read that database's project ref, so a
name built app-side would be wrong. The app sends only `source` (manual or cron) and
`domain`; the runner supplies the ref. Both generators produce byte-identical names —
verified — so dumps from before and after the switch sort and read the same.

Two consequences to expect:

- **The toast stops naming the file.** It says the backup started and the file will
  appear shortly, because this side genuinely cannot know the name. That is correct,
  not a regression.
- **`DIRECT_URL` stops being required for backups**, but is still needed by Prisma
  and by the seed scripts. Do not remove it.

When both databases are the same, the switch changes nothing visible except that the
password leaves the logs. When they differ, the project ref in the file name is what
tells you which one a dump holds.

