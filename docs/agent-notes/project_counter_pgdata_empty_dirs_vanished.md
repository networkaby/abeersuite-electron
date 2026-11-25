---
name: counter-pgdata-empty-dirs-vanished
description: "Counter app 500s everywhere after a power cut = embedded PG's empty folders (pg_notify etc.) gone; recreate them, never re-init pgdata"
metadata:
  type: project
  modified: 2026-11-18T18:30:44.322Z
---

2026-11-18, Counter 94 (owner's PC): after a power failure every /api returned 500 and React #441. main.log showed `FATAL: could not open directory "pg_notify"` — all 12 normally-empty PostgreSQL folders inside `%APPDATA%\abeersuite-electron\pgdata` had vanished (cause unknown; not Claude's clean-up). Recreating them (pg_notify, pg_twophase, pg_tblspc, pg_replslot, pg_snapshots, pg_serial, pg_commit_ts, pg_dynshmem, pg_stat_tmp, pg_wal\archive_status, pg_logical\mappings, pg_logical\snapshots) fixed it with no data loss; owner confirmed the app works.

**Why:** the live-mode fallback also failed ("server does not support SSL connections" — prismaClient.ts uses SSL for any non-localhost host), so one missing folder takes the whole counter down.

**How to apply:** on a counter-wide 500, read `main.log` for `[postgres] FATAL` first; recreate missing empty dirs and test-start with the bundled `resources\pgsql\bin\pg_ctl` on a spare port before touching anything else. The live fallback bug (really: no address at all, since v1.17.9) is fixed in f65f339e8 on main (OFFICE_HANDED_DB / usesOfficeHandedDb), unreleased as of 2026-11-19 — counters need the next release with minimumCounterVersion raised. The self-heal (recreate empty dirs in postgresManager.ts) was offered, not approved.
