-- Retire the old manual price lock (owner, 2026-10-18).
--
-- `InvProduct.priceOverridden` was set by the deleted Items page and made
-- recompute skip the row. The three-voice model (STRATEGY / COMPUTED / SAVED
-- = barcode price) replaced it. Locked rows become SAVED at the price they
-- sell at today, so no customer price moves; then the column goes.

-- 1. Carry the data. `updatedAt` moves so the counters' replicas pull the rows.
--    Already-SAVED rows keep their own saved price (it already won over the lock).
--    A lock with no price has nothing to keep and is simply priced by its voice.
UPDATE "InvProduct"
   SET "effectiveSalePriceSource" = 'SAVED',
       "savedSalePricePaise"      = "effectiveSalePricePaise",
       "updatedAt"                = (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3)
 WHERE "priceOverridden" = true
   AND "effectiveSalePriceSource" <> 'SAVED'
   AND "effectiveSalePricePaise" IS NOT NULL;

-- 2. Drop the column. Counters on this build's push filter no longer send it.
ALTER TABLE "InvProduct" DROP COLUMN "priceOverridden";
