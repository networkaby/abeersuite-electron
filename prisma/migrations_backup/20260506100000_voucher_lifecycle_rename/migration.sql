-- Voucher lifecycle rename: void → cancel.
-- Aligns naming with Tally terminology and prepares the lifecycle pattern
-- to be applied to all voucher types (JournalEntry already had 3-tier delete;
-- InvVoucher had void only).
--
-- Renames:
--   enum  JournalStatus              → VoucherStatus
--   value 'VOIDED'                   → 'CANCELLED'
--   col   JournalEntry.voidedAt      → cancelledAt
--   col   JournalEntry.voidReason    → cancelReason
--   col   JournalEntry.voidedById    → cancelledById
--   col   InvVoucher.voidedAt        → cancelledAt
--   col   InvVoucher.voidReason      → cancelReason
--   FK    JournalEntry_voidedById_fkey → JournalEntry_cancelledById_fkey
--
-- The "delete" tier (Tally: Delete) keeps existing column names deletedAt /
-- deletedById / deleteReason — they were already named that way.

-- 1. Rename enum and value
ALTER TYPE "JournalStatus" RENAME TO "VoucherStatus";
ALTER TYPE "VoucherStatus" RENAME VALUE 'VOIDED' TO 'CANCELLED';

-- 2. Rename JournalEntry columns
ALTER TABLE "JournalEntry" RENAME COLUMN "voidedAt"   TO "cancelledAt";
ALTER TABLE "JournalEntry" RENAME COLUMN "voidReason" TO "cancelReason";
ALTER TABLE "JournalEntry" RENAME COLUMN "voidedById" TO "cancelledById";

-- 3. Rename JournalEntry FK constraint
ALTER TABLE "JournalEntry"
    RENAME CONSTRAINT "JournalEntry_voidedById_fkey" TO "JournalEntry_cancelledById_fkey";

-- 4. Rename InvVoucher columns
ALTER TABLE "InvVoucher" RENAME COLUMN "voidedAt"   TO "cancelledAt";
ALTER TABLE "InvVoucher" RENAME COLUMN "voidReason" TO "cancelReason";
