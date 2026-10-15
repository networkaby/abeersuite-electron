-- Join the broken duty segments of past days into clean ones.
--
-- Why: until 2026-10-13 a beat inside 30 s rounded to 0 minutes and was read as
-- "away", so one stretch at the till was saved as a dozen 0m pieces
-- (10:17-10:17 On duty 0m, Off duty 0m, ...). creditStep fixed that going
-- forward (7a506110); this rewrites the old ledgers by the same rule: a gap
-- inside the person's idle limit is the same segment, only a gap past it breaks.
--
-- Segments only. attendance_days (worked minutes, grade, office mark, HR's
-- corrections) is not touched. The joined segment keeps the first piece's id,
-- the earliest start, the latest end, the SUM of the pieces' minutes (what the
-- clock actually credited — never re-derived from the ends) and the last
-- piece's endedBy. The other pieces are deleted; sync_touch_parent moves the
-- User row, so every till re-pulls the set.
--
-- Today is never touched — its last segment may still be running.
-- Safe to run again: a second run finds nothing to join.
--
--   psql "$DIRECT_URL" -v fix=0 -f scripts/backfill-attendance-segments.sql   (report)
--   psql "$DIRECT_URL" -v fix=1 -f scripts/backfill-attendance-segments.sql   (write)

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE seg ON COMMIT DROP AS
WITH s AS (
    SELECT sp.id, sp."userId", sp.date, sp."startedAt", sp."endedAt", sp.minutes, sp."endedBy",
           COALESCE(sp."endedAt", sp."startedAt" + make_interval(mins => sp.minutes)) AS end_at,
           LEAST(GREATEST(COALESCE(p."idleLimitMinutes", 45), 1), 360) AS limit_min
    FROM attendance_spans sp
    LEFT JOIN staff_profiles p ON p."userId" = sp."userId"
    WHERE sp.date < (now() AT TIME ZONE 'Asia/Kolkata')::date
), o AS (
    SELECT s.*,
           MAX(end_at) OVER (PARTITION BY "userId", date ORDER BY "startedAt", id
                             ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_end
    FROM s
), b AS (
    SELECT o.*,
           SUM(CASE WHEN prev_end IS NULL
                      OR "startedAt" - prev_end > make_interval(mins => limit_min) THEN 1 ELSE 0 END)
               OVER (PARTITION BY "userId", date ORDER BY "startedAt", id) AS island
    FROM o
)
SELECT b.*,
       FIRST_VALUE(id) OVER w                                       AS keep_id,
       COUNT(*) OVER (PARTITION BY "userId", date, island)          AS pieces,
       MIN("startedAt") OVER (PARTITION BY "userId", date, island)  AS new_start,
       MAX(end_at) OVER (PARTITION BY "userId", date, island)       AS new_end,
       SUM(minutes) OVER (PARTITION BY "userId", date, island)      AS new_minutes,
       LAST_VALUE("endedBy") OVER (w ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS new_ended_by
FROM b
WINDOW w AS (PARTITION BY "userId", date, island ORDER BY "startedAt", id);

\echo '— days with pieces to join (before → after) —'
SELECT u.name, date, COUNT(*) AS before, COUNT(DISTINCT island) AS after
FROM seg JOIN "User" u ON u.id = seg."userId"
GROUP BY u.name, date
HAVING COUNT(*) > COUNT(DISTINCT island)
ORDER BY date, u.name;

\if :fix
    UPDATE attendance_spans sp
    SET "startedAt" = g.new_start, "endedAt" = g.new_end, minutes = g.new_minutes,
        "endedBy" = CASE WHEN g.new_ended_by = 'OPEN' THEN 'IDLE' ELSE g.new_ended_by END
    FROM (SELECT DISTINCT keep_id, new_start, new_end, new_minutes, new_ended_by FROM seg WHERE pieces > 1) g
    WHERE sp.id = g.keep_id;

    DELETE FROM attendance_spans WHERE id IN (SELECT id FROM seg WHERE pieces > 1 AND id <> keep_id);
    \echo '— written —'
    COMMIT;
\else
    \echo '— report only (run with -v fix=1 to write) —'
    ROLLBACK;
\endif
