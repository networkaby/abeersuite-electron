-- Actual Worked follows the duty segments (owner, 2026-10-16).
--
-- A past day's worked minutes = the On duty segments laid end to end. The Off
-- duty gaps between segments (a break past the person's idle limit) are not
-- worked. The old clock credited beat by beat and drifted both ways — 29 Sept
-- credited 686 min inside a 10:02-20:40 window (638 min). Run AFTER
-- backfill-attendance-segments.sql, which joins the pieces first.
--
-- Writes attendance_days."workedMinutes" (the "Actual Worked" figure) and each
-- span's minutes. HR's corrections live in overrideWorkedMinutes /
-- overrideLateMinutes and the office mark in status / manualStatus — none of
-- those is touched. Today is never touched. Safe to run again.
--
--   psql "$DIRECT_URL" -v fix=0 -f scripts/backfill-attendance-worked.sql   (report)
--   psql "$DIRECT_URL" -v fix=1 -f scripts/backfill-attendance-worked.sql   (write)

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE span_len ON COMMIT DROP AS
SELECT id, "userId", date,
       GREATEST(ROUND(EXTRACT(EPOCH FROM ("endedAt" - "startedAt")) / 60), 0)::int AS len
FROM attendance_spans
WHERE date < (now() AT TIME ZONE 'Asia/Kolkata')::date AND "endedAt" IS NOT NULL;

CREATE TEMP TABLE day_len ON COMMIT DROP AS
SELECT "userId", date, SUM(len)::int AS len FROM span_len GROUP BY 1, 2;

\echo '— days whose Actual Worked changes —'
SELECT u.name, d.date, d."workedMinutes" AS before, l.len AS after, l.len - d."workedMinutes" AS diff
FROM day_len l
JOIN attendance_days d USING ("userId", date)
JOIN "User" u ON u.id = l."userId"
WHERE d."workedMinutes" <> l.len
ORDER BY d.date, u.name;

\if :fix
    UPDATE attendance_spans sp SET minutes = s.len
    FROM span_len s WHERE sp.id = s.id AND sp.minutes <> s.len;

    UPDATE attendance_days d SET "workedMinutes" = l.len
    FROM day_len l
    WHERE d."userId" = l."userId" AND d.date = l.date AND d."workedMinutes" <> l.len;
    \echo '— written —'
    COMMIT;
\else
    \echo '— report only (run with -v fix=1 to write) —'
    ROLLBACK;
\endif
