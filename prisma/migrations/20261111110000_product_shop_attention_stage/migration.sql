-- Attention becomes a stage (owner, 2026-11-11): a Draft blocked on a manual
-- check is parked here with its reason (shopAttention, added by the previous
-- migration, which was already applied to a local copy and is frozen).
ALTER TYPE "ShopStatus" ADD VALUE 'ATTENTION' AFTER 'DRAFT';
