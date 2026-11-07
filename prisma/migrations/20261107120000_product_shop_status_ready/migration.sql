-- Shop stage READY (owner, 2026-11-07): the work on a product is complete and
-- checked, but it is not published yet — waiting for a good time. Its own file:
-- Postgres cannot use an enum value in the transaction that adds it.
ALTER TYPE "ShopStatus" ADD VALUE IF NOT EXISTS 'READY' BEFORE 'PUBLISHED';
