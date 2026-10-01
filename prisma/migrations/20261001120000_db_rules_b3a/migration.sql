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

-- 3. One numbering method. POS Estimate and POS Order get their own series, in
-- the shop's house format (copied from the POS series), so every voucher type
-- numbers from an atomic per-till counter. A brand-new database has no POS row
-- yet; the seed creates both there.
INSERT INTO "VoucherSeries" ("kind", "label", "fyStartYear", "typeEnabled", "typeValue", "counterEnabled",
                             "yearEnabled", "yearFormat", "startFrom", "padWidth", "nextSeq", "resetGen",
                             "partOrder", "updatedAt")
SELECT k.kind, k.label, p."fyStartYear", p."typeEnabled", k.code, p."counterEnabled",
       p."yearEnabled", p."yearFormat", p."startFrom", p."padWidth", 0, p."resetGen",
       p."partOrder", CURRENT_TIMESTAMP
FROM "VoucherSeries" p
CROSS JOIN (VALUES ('POS_ESTIMATE', 'POS Estimate', 'POSEV'), ('POS_ORDER', 'POS Order', 'POSOD')) AS k(kind, label, code)
WHERE p.kind = 'POS'
ON CONFLICT ("kind") DO NOTHING;

-- 4. No two posted vouchers of one type share a number. Opening-balance vouchers
-- are all titled "Opening Balance" by design and stay out. Server-only: a replica
-- cannot carry a partial index (local-schema.sql), and the Prisma schema does not
-- declare it - see the note on UniversalVoucher.voucherNo. Created only when the
-- data already agrees; otherwise a warning, and `pnpm check:voucher-duplicates`
-- names the rows to fix before a later migration adds it.
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM "UniversalVoucher"
        WHERE status <> 'DRAFT' AND "voucherNo" IS NOT NULL AND type <> 'OPENING'
        GROUP BY type, "voucherNo" HAVING count(*) > 1
    ) THEN
        RAISE WARNING 'Duplicate voucher numbers exist - unique index not created. Run pnpm check:voucher-duplicates.';
    ELSE
        CREATE UNIQUE INDEX IF NOT EXISTS "UniversalVoucher_type_voucherNo_posted_key"
            ON "UniversalVoucher" ("type", "voucherNo")
            WHERE status <> 'DRAFT' AND "voucherNo" IS NOT NULL AND type <> 'OPENING';
    END IF;
END $$;
