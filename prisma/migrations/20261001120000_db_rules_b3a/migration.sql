-- Batch 3a database rules (2026-10-01). Runs on Supabase only: a counter replica
-- gets new columns from resources/local-schema.sql and changed rows through the
-- sync pull, so every data change below that a till must see bumps the parent
-- row's "updatedAt". Idempotent throughout - safe to re-run on a database that
-- already has any part of it.

-- 1. Journal "carrier" rows. Until this release a posted Journal with stock items
-- also created an empty VoucherDetail linked to no voucher; nothing read it. The
-- writer is gone; remove the leftovers. A till drops them at its next reconcile.
DELETE FROM "VoucherDetail" WHERE "universalVoucherId" IS NULL;
