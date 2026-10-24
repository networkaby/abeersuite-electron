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

## The database URL lives only in the repo secret

Done 24 Oct 2026. The app sends **no URL and no file name** with a manual or
Vercel-cron backup; the runner dumps whatever the `DIRECT_DATABASE_URL` repo secret
points at and builds the name itself (`source` and `domain` are all the app sends).

Why: a workflow **input** is echoed in full in the job's env group — secrets are
masked, inputs are not — so sending the URL printed the password in every run's log.
The workflow no longer has a URL input at all.

What it means day to day:

- **A password rotation updates the repo secret too**, or every backup fails.
- **The toast does not name the file** — this side cannot know it. Not a regression.
- **The secret may point at a different database than the app uses**; the project
  ref in the file name tells you which one a dump holds.
- **`DIRECT_URL` is no longer needed for backups**, but Prisma and the seed scripts
  still need it. Do not remove it.

Restore is different by design: the operator types the target database, so its URL
still travels as an input. The workflow's first step masks it (and its password)
before anything else runs, so it shows as `***` in every log line.

