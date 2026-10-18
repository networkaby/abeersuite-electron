-- Repair day totals the sync zeroed — owner, 2026-10-13.
--
-- Before mergeAttendanceDay (src/shared/lib/sync/push.ts) a till's day row went up
-- whole and lost to a later office mark, and the next pull wrote the office's 0
-- minutes over the till's copy. The stretches (attendance_spans) are a separate
-- table and kept the hours, so the day total is put back from them.
--
-- Touches only a day whose total is 0, that nobody corrected by hand, and whose
-- stretches carry minutes. The office mark, source and note are left alone — a
-- Manual day still pays on its mark. In / last-seen are filled only when blank.
--
-- Run the preview first. The repair is one transaction; nothing else changes.
--   psql "$DATABASE_URL" -f scripts/repair-attendance-minutes-from-spans.sql
-- With -v apply=1 it writes; without, it only lists.

\set ON_ERROR_STOP on

WITH s AS (
    SELECT "userId", date, SUM(minutes)::int AS minutes,
           MIN("startedAt") AS first_in, MAX(COALESCE("endedAt", "startedAt")) AS last_seen
      FROM attendance_spans
     GROUP BY "userId", date
)
SELECT d.id, u.name, d.date, d.source, d.status, d."workedMinutes" AS now_minutes, s.minutes AS from_spans
  FROM attendance_days d
  JOIN s ON s."userId" = d."userId" AND s.date = d.date
  JOIN "User" u ON u.id = d."userId"
 WHERE d."workedMinutes" = 0 AND d."overrideWorkedMinutes" IS NULL AND s.minutes > 0
 ORDER BY d.date, u.name;

\if :{?apply}
BEGIN;
WITH s AS (
    SELECT "userId", date, SUM(minutes)::int AS minutes,
           MIN("startedAt") AS first_in, MAX(COALESCE("endedAt", "startedAt")) AS last_seen
      FROM attendance_spans
     GROUP BY "userId", date
)
UPDATE attendance_days d
   SET "workedMinutes" = s.minutes,
       "firstInAt"     = COALESCE(d."firstInAt", s.first_in),
       "lastSeenAt"    = COALESCE(d."lastSeenAt", s.last_seen),
       "updatedAt"     = (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3)
  FROM s
 WHERE s."userId" = d."userId" AND s.date = d.date
   AND d."workedMinutes" = 0 AND d."overrideWorkedMinutes" IS NULL AND s.minutes > 0;
COMMIT;
\endif
