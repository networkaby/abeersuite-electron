-- Attention stage (owner, 2026-11-11): a Draft blocked on a manual check is
-- parked here with a reason until the next working day. The new enum value is
-- not used in this file, so it may share the transaction (PG 12+).
ALTER TYPE "ShopStatus" ADD VALUE 'ATTENTION' AFTER 'DRAFT';
ALTER TABLE "InvProduct" ADD COLUMN "shopAttention" TEXT;
ALTER TABLE "InvProduct" ADD COLUMN "shopAttentionAt" TIMESTAMP(3);
ALTER TABLE "InvProduct" ADD COLUMN "shopAttentionBy" TEXT;
