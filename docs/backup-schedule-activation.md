# Scheduled backup — activation checklist

Status: **built, not switched on.** Nothing in this feature runs yet.

`vercel.json` now ships `"crons": []`, so Vercel starts no backups at all. The
GitHub schedule in `.github/workflows/backup.yml` (09:00 UTC / 14:30 IST daily) is
what keeps automatic backups running meanwhile. To set a Vercel cron time by hand,
see the Backup Schedule section of `README.md`.

Work through this at the production-start commit.

## Why it is built this way

Vercel Cron schedules live in `vercel.json` and are fixed when the deployment is
built. There is no runtime API to toggle one or move its time. So the schedule
cannot be edited from a settings page directly.

The design inverts it. Vercel fires a dumb **tick**; the real decision lives in the
`BackupConfig` row, which the UI can change with no redeploy:

```
Vercel Cron (fixed tick) → /api/cron/backup → read BackupConfig
                                              ├ enabled = false        → skip
                                              ├ not the scheduled slot → skip
                                              └ else                   → dispatch
```

The tick has to fire at least as often as the finest schedule you want to offer.
Hourly (`0 * * * *`) gives the UI any hour of the day.

## Before starting: check the Vercel plan

This is the one thing that decides whether the time picker can work at all.

- **Pro** — crons may run on any schedule. Set the tick to hourly and the feature
  works as designed.
- **Hobby** — crons are limited to **once per day**, triggered at an approximate
  time within the hour. The on/off switch still works, but the time picker cannot:
  the tick only happens once a day, at whatever `vercel.json` says. In that case
  either stay on Pro-style scheduling via the GitHub schedule instead, or accept
  that changing the time needs a redeploy and mark the field read-only.

## What already exists

| Piece | File | State |
|---|---|---|
| Table | `prisma/schema/org.prisma` → `model BackupConfig` | in schema, **not pushed** |
| Row creator | `prisma/seeds/apply-backup-config.ts` | written, **not run** |
| Validation | `src/shared/lib/schemas/backupSchemas.ts` | done |
| API | `src/app/api/settings/backup/schedule/route.ts` | done, live but unread |
| UI card | `src/modules/settings/components/BackupScheduleCard.tsx` | done, **not mounted** |

## Checklist

1. **Confirm the plan tier** (above). If Hobby, decide the time-picker question
   first — the rest of the steps assume Pro.

2. **Create the table.**
   ```bash
   pnpm prisma db push && pnpm tsx prisma/seeds/apply-backup-config.ts
   ```
   Defaults mirror today's schedule (enabled, daily, 21:00 UTC), so nothing about
   when backups happen changes on the day you switch this on.

3. **Add the seed script** to `package.json`:
   `"seed:apply-backup-config": "tsx prisma/seeds/apply-backup-config.ts"`

4. **Speed up the tick** in `vercel.json` — `"schedule": "0 * * * *"`. Only after
   step 5, or an hourly tick means an hourly backup.

5. **Gate the cron route.** In `src/app/api/cron/backup/route.ts`, before
   dispatching: read `BackupConfig`, return early unless `enabled` and the current
   UTC hour/minute matches (and weekday, when weekly). Then set `lastRunAt` after a
   successful dispatch and use it to refuse a second run inside the same slot —
   without that guard a retried tick backs up twice.

6. **Mount the card.** Add `<BackupScheduleCard />` to
   `src/modules/settings/components/BackupRestorePanel.tsx`.

7. **Seeds and docs**, per AGENTS §5–6: add `BackupConfig` to
   `lib/personalSnapshot.ts` (it is real config, not code-owned catalog), update
   `PROJECT_BRAIN.md`, and run `/sync-docs-with-code`.

8. **Verify** — set the time a few minutes ahead, wait for the tick, confirm a dump
   named `smx-backup-<domain>-<ref>-cron-<timestamp>.dump` lands in Dropbox. Then
   switch the toggle off and confirm the next tick does nothing.

## Leave the GitHub schedule alone

`.github/workflows/backup.yml` has its own daily `schedule:` (09:00 UTC / 14:30
IST) that does not depend on Vercel, on the app being up, or on this config row.
That independence is the point — it is the backstop for exactly the case where the
deployment is broken. Do not fold it into this toggle.
