-- Attention stage (owner, 2026-11-11): a product with a problem is flagged by
-- hand (or by Claude) instead of sitting in Draft. null = no problem.
ALTER TABLE "InvProduct" ADD COLUMN "shopAttention" TEXT;
ALTER TABLE "InvProduct" ADD COLUMN "shopAttentionAt" TIMESTAMP(3);
ALTER TABLE "InvProduct" ADD COLUMN "shopAttentionBy" TEXT;
