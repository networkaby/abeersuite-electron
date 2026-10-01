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
