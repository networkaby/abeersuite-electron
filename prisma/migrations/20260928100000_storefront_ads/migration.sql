-- Storefront ad inventory (Ecommerce -> Ads). One JSON column on the settings
-- singleton, same idea as storefrontHomeJson. Idempotent: 0_init is
-- frozen and never declared it, but a replica may already carry it from
-- local-schema.sql.
ALTER TABLE "OrgDefaults" ADD COLUMN IF NOT EXISTS "storefrontAdsJson" JSONB;

-- ── Convert and merge leave no tombstone ─────────────────────────────────────
--
-- A Person <-> Company conversion and a duplicate merge now re-point every
-- bill, ticket, CRM note and contact at the surviving row and delete the old
-- one inside their own transaction, so the forwarding columns go:
--   Person.convertedToCompanyId / convertedAt   Company.convertedToPersonId / convertedAt
--   Person.mergedIntoPersonId   / mergedAt      Company.mergedIntoCompanyId / mergedAt
-- Before they go, the tombstones already on the books get the same treatment.
--
-- A tombstone forwards one hop: a merge stays in its table, a conversion
-- crosses tables. Chains exist (a duplicate merged into a person who was later
-- converted; a converted company later merged), so each tombstone is walked to
-- the record that is live today — one that forwards nowhere — before anything
-- is re-pointed. Both tools refuse a target that is already a tombstone, so
-- the walk cannot loop; the depth cap is belt and braces.
--
-- Bills name their party as (partyType, partyId) with no FK: 'customer' is a
-- Person, 'company' is a Company. Everything else is a plain FK.

CREATE TEMP TABLE party_forward AS
WITH RECURSIVE edge AS (
    SELECT 'person'::text  AS kind, id, 'person'::text  AS to_kind, "mergedIntoPersonId"   AS to_id FROM "Person"  WHERE "mergedIntoPersonId"   IS NOT NULL
    UNION ALL
    SELECT 'person',       id, 'company', "convertedToCompanyId" FROM "Person"  WHERE "convertedToCompanyId" IS NOT NULL
    UNION ALL
    SELECT 'company',      id, 'company', "mergedIntoCompanyId"  FROM "Company" WHERE "mergedIntoCompanyId"  IS NOT NULL
    UNION ALL
    SELECT 'company',      id, 'person',  "convertedToPersonId"  FROM "Company" WHERE "convertedToPersonId"  IS NOT NULL
),
walk AS (
    SELECT kind, id, to_kind, to_id, 1 AS depth FROM edge
    UNION ALL
    SELECT w.kind, w.id, e.to_kind, e.to_id, w.depth + 1
    FROM walk w JOIN edge e ON e.kind = w.to_kind AND e.id = w.to_id
    WHERE w.depth < 8
)
SELECT DISTINCT ON (kind, id) kind, id, to_kind, to_id
FROM walk
ORDER BY kind, id, depth DESC;

-- 1. Bills: the stored party reference follows the party.
UPDATE "VoucherDetail" v
SET "partyType" = CASE f.to_kind WHEN 'person' THEN 'customer' ELSE 'company' END,
    "partyId"   = f.to_id
FROM party_forward f
WHERE v."partyId" = f.id
  AND v."partyType" = CASE f.kind WHEN 'person' THEN 'customer' ELSE 'company' END;

-- 2. Deals, help tickets and CRM notes carry both a personId and a companyId,
--    so a re-point just sets the right side. A delete would cascade the notes
--    away and SET NULL the tickets, which is why this runs first.
UPDATE "TicketDeal" t SET "personId" = CASE f.to_kind WHEN 'person' THEN f.to_id END, "companyId" = CASE f.to_kind WHEN 'company' THEN f.to_id END
FROM party_forward f WHERE f.kind = 'person' AND t."personId" = f.id;
UPDATE "TicketDeal" t SET "personId" = CASE f.to_kind WHEN 'person' THEN f.to_id END, "companyId" = CASE f.to_kind WHEN 'company' THEN f.to_id END
FROM party_forward f WHERE f.kind = 'company' AND t."companyId" = f.id;

UPDATE "TicketHelp" t SET "personId" = CASE f.to_kind WHEN 'person' THEN f.to_id END, "companyId" = CASE f.to_kind WHEN 'company' THEN f.to_id END
FROM party_forward f WHERE f.kind = 'person' AND t."personId" = f.id;
UPDATE "TicketHelp" t SET "personId" = CASE f.to_kind WHEN 'person' THEN f.to_id END, "companyId" = CASE f.to_kind WHEN 'company' THEN f.to_id END
FROM party_forward f WHERE f.kind = 'company' AND t."companyId" = f.id;

UPDATE "TicketLog" t SET "personId" = CASE f.to_kind WHEN 'person' THEN f.to_id END, "companyId" = CASE f.to_kind WHEN 'company' THEN f.to_id END
FROM party_forward f WHERE f.kind = 'person' AND t."personId" = f.id;
UPDATE "TicketLog" t SET "personId" = CASE f.to_kind WHEN 'person' THEN f.to_id END, "companyId" = CASE f.to_kind WHEN 'company' THEN f.to_id END
FROM party_forward f WHERE f.kind = 'company' AND t."companyId" = f.id;

-- 3. Contacts the old tools left behind (both normally moved them already).
UPDATE "Phone" t SET "personId" = CASE f.to_kind WHEN 'person' THEN f.to_id END, "companyId" = CASE f.to_kind WHEN 'company' THEN f.to_id END
FROM party_forward f WHERE f.kind = 'person' AND t."personId" = f.id;
UPDATE "Phone" t SET "personId" = CASE f.to_kind WHEN 'person' THEN f.to_id END, "companyId" = CASE f.to_kind WHEN 'company' THEN f.to_id END
FROM party_forward f WHERE f.kind = 'company' AND t."companyId" = f.id;
UPDATE "Email" t SET "personId" = CASE f.to_kind WHEN 'person' THEN f.to_id END, "companyId" = CASE f.to_kind WHEN 'company' THEN f.to_id END
FROM party_forward f WHERE f.kind = 'person' AND t."personId" = f.id;
UPDATE "Email" t SET "personId" = CASE f.to_kind WHEN 'person' THEN f.to_id END, "companyId" = CASE f.to_kind WHEN 'company' THEN f.to_id END
FROM party_forward f WHERE f.kind = 'company' AND t."companyId" = f.id;

-- 4. Shop orders name a person only: follow a person -> person forward, detach
--    otherwise (the order's accountId still carries the receivable).
UPDATE "TicketOrder" t SET "personId" = CASE f.to_kind WHEN 'person' THEN f.to_id END
FROM party_forward f WHERE f.kind = 'person' AND t."personId" = f.id;

-- 5. "Contact at company" links: a same-table forward keeps the link on the
--    survivor; a conversion makes it meaningless. Then drop the duplicates a
--    merge can create, keeping the oldest.
UPDATE "PersonCompany" l SET "personId" = f.to_id
FROM party_forward f WHERE f.kind = 'person' AND f.to_kind = 'person' AND l."personId" = f.id;
UPDATE "PersonCompany" l SET "companyId" = f.to_id
FROM party_forward f WHERE f.kind = 'company' AND f.to_kind = 'company' AND l."companyId" = f.id;
DELETE FROM "PersonCompany" l USING party_forward f WHERE f.kind = 'person'  AND l."personId"  = f.id;
DELETE FROM "PersonCompany" l USING party_forward f WHERE f.kind = 'company' AND l."companyId" = f.id;
DELETE FROM "PersonCompany" a USING "PersonCompany" b
WHERE a."personId" = b."personId" AND a."companyId" = b."companyId" AND a.id > b.id;

-- 6. A tombstone's Account was flipped (convert) or dissolved (merge) when it
--    was made; anything still attached would block the delete, so detach it.
UPDATE "Account" a SET "personId"  = NULL FROM party_forward f WHERE f.kind = 'person'  AND a."personId"  = f.id;
UPDATE "Account" a SET "companyId" = NULL FROM party_forward f WHERE f.kind = 'company' AND a."companyId" = f.id;

-- 7. The tombstones themselves (portal credential, social profile and friend
--    links cascade — a merge loser's were dropped when it was made).
DELETE FROM "Person"  p USING party_forward f WHERE f.kind = 'person'  AND p.id = f.id;
DELETE FROM "Company" c USING party_forward f WHERE f.kind = 'company' AND c.id = f.id;
DROP TABLE party_forward;

-- 8. The columns. IF EXISTS: a replica may already be ahead through local-schema.sql.
ALTER TABLE "Person"  DROP CONSTRAINT IF EXISTS "Person_convertedToCompanyId_fkey";
ALTER TABLE "Person"  DROP CONSTRAINT IF EXISTS "Person_mergedIntoPersonId_fkey";
ALTER TABLE "Company" DROP CONSTRAINT IF EXISTS "Company_convertedToPersonId_fkey";
ALTER TABLE "Company" DROP CONSTRAINT IF EXISTS "Company_mergedIntoCompanyId_fkey";
ALTER TABLE "Person"
    DROP COLUMN IF EXISTS "convertedToCompanyId", DROP COLUMN IF EXISTS "convertedAt",
    DROP COLUMN IF EXISTS "mergedIntoPersonId",   DROP COLUMN IF EXISTS "mergedAt";
ALTER TABLE "Company"
    DROP COLUMN IF EXISTS "convertedToPersonId",  DROP COLUMN IF EXISTS "convertedAt",
    DROP COLUMN IF EXISTS "mergedIntoCompanyId",  DROP COLUMN IF EXISTS "mergedAt";
