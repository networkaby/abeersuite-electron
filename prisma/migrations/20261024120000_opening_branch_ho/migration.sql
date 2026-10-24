-- Every opening stock sits at a branch — the old ones that have none go to Head
-- Office.
--
-- ── Why ──────────────────────────────────────────────────────────────────────
-- An opening is counted at a counter, and a counter belongs to a branch, so an
-- opening quantity with no branch is not a real state. Until 2026-10-24 the read
-- rule (openingAppliesTo, src/modules/inventory/lib/liveStock.ts) folded such an
-- opening into EVERY branch: opening 40 read 40 at Head Office and 40 at Branch 2,
-- 80 added up, 40 real. The rule now reads it as Head Office only, and writers
-- always stamp a branch (openingBranchOnSave). This puts the branch on the rows
-- created between 20260917090000_product_opening_branch (which did the same for
-- every opening that existed then) and that change. Owner: "every stock must have
-- a branch, backfill BR-HQ".
--
-- Same answer as systemBranchId (src/shared/lib/org/systemBranch.ts): BR-HQ, else
-- the lowest-numbered branch; a database with no branch at all is left alone.
--
-- ── Data only ───────────────────────────────────────────────────────────────
-- No column changes, so a counter replica cannot drift (schemaGuard) and this does
-- not need a counter release first. A replica never runs this file: it sees the
-- change through the sync pull, which is why "updatedAt" moves in the same
-- statement (docs/migrations.md, "What a migration cannot hand to a counter").
-- Company totals do not move; only branch figures do, and they now add up to the
-- company total. Safe to re-run: the second run finds no row.

UPDATE "InvProduct"
   SET "openingBranchId" = (
           SELECT "id" FROM "Branch"
            ORDER BY ("id" = 'BR-HQ') DESC, "number" ASC
            LIMIT 1
       ),
       "updatedAt" = CURRENT_TIMESTAMP
 WHERE "openingBranchId" IS NULL
   AND "openingStock" IS NOT NULL
   AND EXISTS (SELECT 1 FROM "Branch");
