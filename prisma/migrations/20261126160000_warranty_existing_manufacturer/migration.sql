-- Owner, 2026-11-26: every warranty term that existed before warranty types
-- is a MANUFACTURER warranty, not the shop's own. The previous migration
-- (20261126140000_warranty_type) set them to SELLER by the column default; it
-- was already recorded on the local copy, so this is its own file rather than
-- an edit. On a database that runs both in one deploy, every SELLER row here is
-- one of those pre-existing terms. New terms default to MANUFACTURER too.
-- updatedAt is bumped so the counters pull the change.
ALTER TABLE "InvWarrantyTerm" ALTER COLUMN "warrantyType" SET DEFAULT 'MANUFACTURER';

UPDATE "InvWarrantyTerm"
   SET "warrantyType" = 'MANUFACTURER', "updatedAt" = CURRENT_TIMESTAMP
 WHERE "warrantyType" = 'SELLER'
   AND "sellerDays" IS NULL
   AND "createdAt" < TIMESTAMP '2026-11-26 00:00:00';
