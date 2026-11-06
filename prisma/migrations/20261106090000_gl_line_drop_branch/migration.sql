-- A GL line's branch is its voucher's branch (UniversalVoucher."branchId").
-- The per-line copy was half-filled (bank-import and edit paths left it NULL),
-- so the ledger showed a blank branch where the Day Book showed one. Nothing
-- reads it any more. Counters must take the build without it first (push sends
-- only registry columns), then this deploy.
DROP INDEX IF EXISTS "VoucherGlLine_branchId_accountId_idx";
ALTER TABLE "VoucherGlLine" DROP COLUMN IF EXISTS "branchId";
