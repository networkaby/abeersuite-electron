---
name: project_vercel_nightly_backup_floor
description: GitHub's hourly backup tick only fires ~6x a day, so a Vercel nightly cron was added 2026-09-20 as the guaranteed floor; live only after a d_office deploy.
metadata:
  type: project
---

GitHub's "hourly" schedule is best-effort and does not deliver hourly: measured
over two weeks in Sept 2026 it arrived about **6 times a day at random minutes**,
so a picked hour lands roughly one time in four. That is why the 1 AM and 4 AM
backup slots kept being missed — every tick that did arrive landed on a different
hour and skipped correctly.

Commit e0834238 added a Vercel cron in `vercel.json`: `/api/cron/backup` at
`30 16 * * *` (16:30 UTC = 10 PM IST, approximate within the hour on Hobby).
Deliberately ungated — it does not ask `/api/cron/backup-due` and ignores the
Settings on/off switch, so nothing in the app can leave the business with no
backup. It takes effect only on a `d_office` push, not on the commit.

Two things still open:
- The **catch-up fix** to `isDue()` — match "any wanted hour since lastRunAt"
  instead of the exact hour, so a dropped tick still honours the slot. Not
  started; this is the real cure for the missed 1 AM / 4 AM.
- Sunday 10 PM now fires twice (the GitHub safety net is also `30 16 * * 0`).
  Harmless duplicate dump; owner not yet asked whether to drop the net.

**Why:** the schedule looked fine in Settings while backups silently were not
happening, and nothing in the logs said so.
**How to apply:** treat the Settings hours as a bonus, never the guarantee.
See [project_backup_secret_masking_deferred](project_backup_secret_masking_deferred.md).
