-- Batch 3b database clean-up (2026-10-02). Runs on Supabase only.
--
-- RELEASE GATE: every till must run the build that carries this migration
-- BEFORE the d_office push applies it. A replica keeps every column it was
-- ever given and ships whole rows; only that build strips columns the office
-- no longer has (SyncRegistryEntry.columns), so an older till would have its
-- voucher uploads held in its queue until it updates. Idempotent throughout.

-- 1. Voucher soft-delete columns. Soft-delete was retired 2026-08-01; nothing
-- has written these since, and every filter on them was always true.
DROP INDEX IF EXISTS "UniversalVoucher_deletedAt_idx";
ALTER TABLE "UniversalVoucher" DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE "UniversalVoucher" DROP COLUMN IF EXISTS "deletedById";
ALTER TABLE "UniversalVoucher" DROP COLUMN IF EXISTS "deleteReason";

-- 2. The series-level running number. The number has lived per counter in
-- VoucherSeriesCounter since 2026-09; the series row only mirrored counter 1's
-- for the Year Ending page, which now reads the counter rows. A series the office
-- numbered before its counter-1 row existed carries the number across first.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'VoucherSeries' AND column_name = 'nextSeq') THEN
        INSERT INTO "VoucherSeriesCounter" ("kind", "counterNumber", "nextSeq", "fyStartYear", "resetGen", "updatedAt")
        SELECT s."kind", 1, s."nextSeq", s."fyStartYear", s."resetGen", CURRENT_TIMESTAMP
        FROM "VoucherSeries" s
        WHERE s."nextSeq" > 0
        ON CONFLICT ("kind", "counterNumber") DO NOTHING;
    END IF;
END $$;
ALTER TABLE "VoucherSeries" DROP COLUMN IF EXISTS "nextSeq";
