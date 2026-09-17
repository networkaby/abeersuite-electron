-- Opening stock gets a STOCK LOCATION, and every existing opening is backfilled to
-- Head Office.
--
-- ── The fault ────────────────────────────────────────────────────────────────
-- `InvProduct.openingStock` is a master column with no branch on it, so the read
-- rule in src/modules/inventory/lib/liveStock.ts had no choice but to fold the whole
-- opening quantity into EVERY branch scope:
--
--     stock = openingStock + Σ(inQty − outQty)
--             └ folded everywhere      └ the only branch-aware half
--
-- With one branch that is invisible. With two it means a product that opened with 40
-- units shows 40 at Head Office AND 40 at the second branch, and adding the two
-- branch reports together double-counts the opening. On live that is 644 of 1467
-- products and 12,865 units — the same rows the liveStock fix had to rescue from
-- reading zero.
--
-- ── The column ───────────────────────────────────────────────────────────────
-- `openingBranchId` scopes the opening QUANTITY only. It does NOT make the product
-- master branch-owned — there is still deliberately no `branchId` on "InvProduct",
-- one product row is shared by every branch — and it does NOT touch money:
-- `openingValue`, the trading-stock adjustment and every valuation stay org-level,
-- exactly as they are today.
--
-- NULL keeps its old meaning on purpose: an opening with no branch folds into every
-- branch, as it always has. So a product this migration does not reach, or one an
-- operator creates by hand without choosing a location, reads exactly as it read
-- before — nothing vanishes from a screen. ON DELETE SET NULL for the same reason:
-- deleting a branch must not take an opening quantity with it, it only makes the
-- opening unassigned again.
--
-- ── The backfill ─────────────────────────────────────────────────────────────
-- Every opening on live predates multi-branch, and all of it is physically at Head
-- Office, so BR-HQ is the correct answer for all of it — confirmed by the owner, and
-- the id prisma/seeds/bootstrap-seed.ts seeds (branch number 9, "Head Office").
--
-- It runs here rather than in a script for two reasons: `prisma migrate deploy` is
-- what carries schema to live (vercel-build), and the same file is what each counter
-- replica applies — so the data lands everywhere the column does, in one step, with
-- no tsx script to run by hand.
--
-- Guarded three ways, so it is safe to re-run and safe on a database that has no
-- Head Office branch (a fresh demo reset, or a setup that renamed its branches):
--   * `openingBranchId IS NULL`  — never re-stamps a row someone has since moved.
--   * `openingStock IS NOT NULL` — a product with no opening has no location to set.
--   * `EXISTS (… WHERE id = 'BR-HQ')` — no branch, no backfill, and no FK violation.
--     Those rows stay NULL, which means "folds into every branch" — the old
--     behaviour, which is the right thing to fall back to.
--
-- ── Idempotent on purpose ────────────────────────────────────────────────────
-- 0_init is regenerated from the schema, so a brand new database arrives here with
-- the column already present; live may carry it from a hand-run `prisma db push`;
-- a replica gets it from resources/local-schema.sql at app upgrade. Hence
-- IF NOT EXISTS throughout. 0_init must NOT be edited — its checksum is recorded in
-- `_prisma_migrations` on every baselined database.
--
-- The column stays NULLABLE on every database, so there is no nullability drift for
-- sync-engine/lib/schemaGuard.js to halt a counter over (exit 4 stops that till's
-- whole worker, not just this table).

ALTER TABLE "InvProduct"
    ADD COLUMN IF NOT EXISTS "openingBranchId" TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'InvProduct_openingBranchId_fkey'
    ) THEN
        ALTER TABLE "InvProduct"
            ADD CONSTRAINT "InvProduct_openingBranchId_fkey"
            FOREIGN KEY ("openingBranchId") REFERENCES "Branch"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- Reads that ask "what is lying at this branch" filter on it beside the ledger sum.
CREATE INDEX IF NOT EXISTS "InvProduct_openingBranchId_idx" ON "InvProduct"("openingBranchId");

-- The backfill. See the guards above — re-running this changes nothing.
UPDATE "InvProduct"
   SET "openingBranchId" = 'BR-HQ'
 WHERE "openingBranchId" IS NULL
   AND "openingStock" IS NOT NULL
   AND EXISTS (SELECT 1 FROM "Branch" WHERE "id" = 'BR-HQ');
