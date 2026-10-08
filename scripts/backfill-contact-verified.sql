-- Mark every staff-entered mobile and email as verified, skipping placeholders.
--
-- Why: `verifiedAt` decides who can sign in by OTP, be a primary contact and
-- reset a password. Staff-entered contacts are verified on entry (they met the
-- customer), but rows saved before that rule have it null. Owner's call
-- (2026-10-07): every contact created before today was entered by staff, so it
-- counts as verified — unless it is a placeholder.
--
-- Covers people AND companies. Placeholders stay null:
--   mobile — not 10 digits starting 6-9 (after +91 / 0), one digit repeated,
--            one digit filling 8+ places, or 1234567890 / 9876543210.
--   email  — anything not @gmail.com (owner's call 2026-10-07: only Gmail
--            counts), or a "no / none / na / noemail / test / dummy" name part.
--
-- `verifiedAt` takes the row's own createdAt (proved when staff entered it).
-- `updatedAt` is bumped so the counters' watermark pull carries the change.
-- Only null rows are touched, so a second run changes nothing.
--
-- Dry run (lists, writes nothing — ends in ROLLBACK):
--   psql "$DIRECT_URL" -f scripts/backfill-contact-verified.sql
-- Apply:
--   psql "$DIRECT_URL" -v apply=1 -f scripts/backfill-contact-verified.sql

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE _cutoff AS
SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date::timestamp AT TIME ZONE 'Asia/Kolkata' AT TIME ZONE 'UTC') AS ts;

CREATE TEMP TABLE _phone AS
SELECT p.id, p.phone, p."personId", p."companyId",
       CASE WHEN length(d) = 12 AND d LIKE '91%' THEN substr(d, 3)
            WHEN length(d) = 11 AND d LIKE '0%'  THEN substr(d, 2)
            ELSE d END AS n
FROM "Phone" p
CROSS JOIN LATERAL (SELECT regexp_replace(p.phone, '\D', '', 'g') AS d) x
WHERE p."verifiedAt" IS NULL AND p."createdAt" < (SELECT ts FROM _cutoff);

ALTER TABLE _phone ADD COLUMN real boolean;
UPDATE _phone SET real =
      n ~ '^[6-9][0-9]{9}$'
  AND n NOT IN ('1234567890', '9876543210')
  AND NOT EXISTS (
        SELECT 1 FROM generate_series(0, 9) g
        WHERE length(n) - length(replace(n, g::text, '')) >= 8);

CREATE TEMP TABLE _email AS
SELECT e.id, e.email, e."personId", e."companyId",
       lower(trim(e.email)) ~ '^[a-z0-9._%+-]+@gmail\.com$'
   AND split_part(lower(trim(e.email)), '@', 1) NOT IN
       ('no', 'none', 'na', 'nil', 'noemail', 'nomail', 'test', 'dummy', 'abc', 'xyz')
   AS real
FROM "Email" e
WHERE e."verifiedAt" IS NULL AND e."createdAt" < (SELECT ts FROM _cutoff);

\echo '— mobiles: count by outcome —'
SELECT real, count(*) FROM _phone GROUP BY real ORDER BY real;
\echo '— mobiles skipped as placeholder —'
SELECT id, phone, "personId", "companyId" FROM _phone WHERE NOT real ORDER BY id;

\echo '— emails: count by outcome —'
SELECT real, count(*) FROM _email GROUP BY real ORDER BY real;
\echo '— emails skipped as placeholder —'
SELECT id, email, "personId", "companyId" FROM _email WHERE NOT real ORDER BY id;

UPDATE "Phone" p SET "verifiedAt" = p."createdAt", "updatedAt" = now() AT TIME ZONE 'UTC'
FROM _phone t WHERE t.id = p.id AND t.real AND p."verifiedAt" IS NULL;

UPDATE "Email" e SET "verifiedAt" = e."createdAt", "updatedAt" = now() AT TIME ZONE 'UTC'
FROM _email t WHERE t.id = e.id AND t.real AND e."verifiedAt" IS NULL;

\echo '— still unverified after this run —'
SELECT 'Phone' AS tbl, count(*) FROM "Phone" WHERE "verifiedAt" IS NULL
UNION ALL
SELECT 'Email', count(*) FROM "Email" WHERE "verifiedAt" IS NULL;

\if :{?apply}
  COMMIT;
  \echo 'APPLIED.'
\else
  ROLLBACK;
  \echo 'DRY RUN — rolled back. Re-run with -v apply=1 to write.'
\endif
