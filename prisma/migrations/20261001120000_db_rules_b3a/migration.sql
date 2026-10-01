-- Batch 3a database rules (2026-10-01). Runs on Supabase only: a counter replica
-- gets new columns from resources/local-schema.sql and changed rows through the
-- sync pull, so every data change below that a till must see bumps the parent
-- row's "updatedAt". Idempotent throughout - safe to re-run on a database that
-- already has any part of it.

-- 1. Journal "carrier" rows. Until this release a posted Journal with stock items
-- also created an empty VoucherDetail linked to no voucher; nothing read it. The
-- writer is gone; remove the leftovers. A till drops them at its next reconcile.
DELETE FROM "VoucherDetail" WHERE "universalVoucherId" IS NULL;

-- 2. Stock reversal link. A cancel writes one counter-row per original stock row;
-- the counter-row now names the row it reverses, so a restore removes exactly those
-- and a cancel never reverses a reversal (a ₹0 free-issue reversal has amount 0).
ALTER TABLE "InvStockLedger" ADD COLUMN IF NOT EXISTS "reversalOfId" INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS "InvStockLedger_reversalOfId_key" ON "InvStockLedger"("reversalOfId");
DO $$ BEGIN
    ALTER TABLE "InvStockLedger" ADD CONSTRAINT "InvStockLedger_reversalOfId_fkey"
        FOREIGN KEY ("reversalOfId") REFERENCES "InvStockLedger"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Backfill: vouchers cancelled before this release hold 2N rows, originals first
-- (by id) and their counters after, in the same order — the pairing the restore
-- used until now. Only clean, mirrored trails are linked; a voucher already linked
-- is left alone, so a re-run changes nothing.
WITH trail AS (
    SELECT s.id, s."universalVoucherId" AS v, s."productId", s."branchId", s."inQty", s."outQty",
           row_number() OVER (PARTITION BY s."universalVoucherId" ORDER BY s.id) AS rn,
           count(*)     OVER (PARTITION BY s."universalVoucherId")               AS n
    FROM "InvStockLedger" s
    JOIN "UniversalVoucher" u ON u.id = s."universalVoucherId"
    WHERE u.status = 'CANCELLED'
      AND NOT EXISTS (SELECT 1 FROM "InvStockLedger" x
                      WHERE x."universalVoucherId" = u.id AND x."reversalOfId" IS NOT NULL)
), pairs AS (
    SELECT o.v, o.id AS original_id, c.id AS counter_id,
           (o."productId" = c."productId" AND o."branchId" = c."branchId"
            AND round(o."inQty") = round(c."outQty") AND round(o."outQty") = round(c."inQty")) AS mirrors
    FROM trail o
    JOIN trail c ON c.v = o.v AND c.rn = o.rn + o.n / 2
    WHERE o.n % 2 = 0 AND o.rn <= o.n / 2
), clean AS (
    SELECT * FROM pairs p
    WHERE NOT EXISTS (SELECT 1 FROM pairs q WHERE q.v = p.v AND NOT q.mirrors)
), linked AS (
    UPDATE "InvStockLedger" s SET "reversalOfId" = clean.original_id
    FROM clean WHERE s.id = clean.counter_id
    RETURNING clean.v
)
-- InvStockLedger has no updatedAt; tills re-pull a voucher's stock rows when its
-- spine moves.
UPDATE "UniversalVoucher" SET "updatedAt" = CURRENT_TIMESTAMP
WHERE id IN (SELECT DISTINCT v FROM linked);
