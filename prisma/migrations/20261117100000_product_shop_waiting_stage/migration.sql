-- Waiting becomes a shop stage (owner, 2026-11-17): products shortlisted for the
-- AI run (product-prep), or sent back from Attention once fixed. Its own file:
-- Postgres cannot use an enum value in the transaction that adds it.
ALTER TYPE "ShopStatus" ADD VALUE 'WAITING' AFTER 'UNPUBLISHED';
