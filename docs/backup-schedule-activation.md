# Scheduled backup — activation checklist

Status: **built, not switched on.** Nothing in this feature runs yet.

`vercel.json` now ships `"crons": []`, so Vercel starts no backups at all. The
GitHub schedule in `.github/workflows/backup.yml` (09:00 UTC / 14:30 IST daily) is
what keeps automatic backups running meanwhile. To set a Vercel cron time by hand,
see the Backup Schedule section of `README.md`.

**The on/off half is already solved, elsewhere.** Settings → Backup & Restore now
carries an *Automatic backup* switch that enables/disables `backup-scheduled.yml`
through GitHub's API — no table, no tick, no redeploy. What remains unbuilt here is
only editing the *times* from the UI; those live in that workflow file today.

So read the rest of this as: worth doing if changing the schedule from the UI ever
becomes a real need, and not before.

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

## The plan is Hobby — read this before building on it

This project is on Vercel **Hobby** (free), where crons run **once per day** and
fire at an approximate time within the hour. That breaks the central assumption of
the design above: there is no hourly tick to gate, so **the time picker cannot
work**. The tick happens once a day at whatever `vercel.json` says, and moving it
needs a deploy.

What still works on Hobby:

- **The on/off toggle.** The tick fires; the route reads `enabled` and does
  nothing. That is a genuine in-app switch with no redeploy, and it is most of the
  value.
- **Weekly.** A daily tick can be gated down to one weekday.

What does not:

- **Choosing the hour.** Ship the time field read-only, showing the `vercel.json`
  time with a note that changing it needs a deploy — or leave it out entirely and
  keep `README.md` as the place where the time is set.

If per-hour control is genuinely wanted later, the cheaper route is not a Vercel
upgrade: `.github/workflows/backup.yml` can hold any schedule, on any plan, free.
Move the tick there and have it call the app, or let it keep dumping directly.

## What already exists

| Piece | File | State |
|---|---|---|
| Table | `prisma/schema/org.prisma` → `model BackupConfig` | in schema, **not pushed** |
| Row creator | `prisma/seeds/apply-backup-config.ts` | written, **not run** |
| Validation | `src/shared/lib/schemas/backupSchemas.ts` | done |
| API | `src/app/api/settings/backup/schedule/route.ts` | done, live but unread |
| UI card | `src/modules/settings/components/BackupScheduleCard.tsx` | done, **not mounted** |

## Checklist

1. **Decide the time-picker question** (above) — on Hobby it must be read-only or
   dropped. `BackupScheduleCard.tsx` currently renders it as editable, so this is a
   real edit to that file, not just a decision.

2. **Create the table.**
   ```bash
   pnpm prisma db push && pnpm tsx prisma/seeds/apply-backup-config.ts
   ```
   Defaults mirror today's schedule (enabled, daily, 21:00 UTC), so nothing about
   when backups happen changes on the day you switch this on.

3. **Add the seed script** to `package.json`:
   `"seed:apply-backup-config": "tsx prisma/seeds/apply-backup-config.ts"`

4. **Set the tick** in `vercel.json` — on Hobby this stays a once-daily schedule
   (see `README.md` for the syntax). An hourly tick is neither allowed on this plan
   nor safe before step 5, since the route would dispatch on every one.

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
   named `smx-backup-<domain>-<ref>-cron-<timestamp>-IST.dump` lands in Dropbox.
   Then switch the toggle off and confirm the next tick does nothing.

## Leave the GitHub schedule alone

`.github/workflows/backup.yml` has its own daily `schedule:` (09:00 UTC / 14:30
IST) that does not depend on Vercel, on the app being up, or on this config row.
That independence is the point — it is the backstop for exactly the case where the
deployment is broken. Do not fold it into this toggle.
