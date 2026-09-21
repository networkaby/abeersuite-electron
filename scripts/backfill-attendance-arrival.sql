-- Fill a till day's missing arrival time from the shift that was open that day.
--
-- Why: until 2026-09-22 the arrival was stamped only at counter sign-in, which
-- needs COUNTER_MACHINE_ID plus the counter setup file. Where either was missing
-- the stamp was skipped in silence and the shift CLOSE created the row instead —
-- an out time with no in time, a day reading present since never. The code now
-- stamps at shift open too (src/app/api/pos/shifts/route.ts), but that does not
-- reach backwards. This does.
--
-- Safe to run repeatedly: it only ever writes where `firstInAt` IS NULL, so a
-- real sign-in time is never overwritten and a second run changes nothing.
--
-- COUNTER rows only. A day marked from the office is HR's record, not the till's:
-- filling an arrival into it would rewrite one system's answer with another's, and
-- on an ABSENT or LEAVE day it would be plainly wrong. The local copy has 104
-- OFFICE rows with no arrival and none of them are this bug.
--
-- The business day is the shop's (Asia/Kolkata), never the server's UTC day —
-- same rule as businessTodayIso() in src/shared/lib/format/formatDate.ts.
--
-- BOTH zones have to be named. `openedAt` is `timestamp without time zone`
-- holding UTC, so a bare `AT TIME ZONE 'Asia/Kolkata'` reads it as already being
-- Kolkata time and converts the wrong way — it put shift 16 (21 Sep 10:32 IST)
-- on 20 Sep and the backfill then matched nothing at all.
--
--   psql "$DIRECT_URL" -f scripts/backfill-attendance-arrival.sql

\echo '— before —'
SELECT a.date, a."userId", a."firstInAt", a."lastOutAt", a."counterId"
FROM attendance_days a
WHERE a."firstInAt" IS NULL AND a.source = 'COUNTER'
ORDER BY a.date DESC;

WITH first_shift AS (
    SELECT DISTINCT ON (s."userId", (s."openedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date)
           s."userId",
           (s."openedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS business_day,
           s."openedAt",
           s."counterId"
    FROM pos_shifts s
    ORDER BY s."userId",
             (s."openedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date,
             s."openedAt" ASC          -- the day's FIRST till open is the arrival
)
UPDATE attendance_days a
SET    "firstInAt" = f."openedAt",
       "counterId" = COALESCE(a."counterId", f."counterId"),
       -- Raw SQL does not fire Prisma's @updatedAt, and the counters' replicas
       -- delta-sync on "what changed since <ts>?" — without this bump the repair
       -- would sit on the server and never reach a till.
       "updatedAt" = now()
FROM   first_shift f
WHERE  a."userId" = f."userId"
  AND  a.date     = f.business_day
  AND  a."firstInAt" IS NULL
  AND  a.source     = 'COUNTER';

\echo '— after —'
SELECT a.date, a."userId", a.source, a."firstInAt", a."lastOutAt", a."counterId"
FROM attendance_days a
WHERE a.source = 'COUNTER'
ORDER BY a.date DESC, a."userId";
