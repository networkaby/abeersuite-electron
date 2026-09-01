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
   | `CRON_SECRET` | same value as the Vercel env var | without it the endpoint is open, and anyone could stamp `lastRunAt` to suppress a real backup |

   `DIRECT_DATABASE_URL` must already be set, holding the **direct** URL — port 5432,
   no `pgbouncer=true`. The pooled URL makes `pg_dump` write a 0-byte dump.

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
