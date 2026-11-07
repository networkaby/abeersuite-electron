-- Online-shop stage of a product (owner, 2026-11-07):
-- UNPUBLISHED (new / made at a counter / untouched) → DRAFT (being worked on,
-- by AI or staff) → PUBLISHED. "Pending" = PUBLISHED with a publish rule unmet;
-- it is not stored. isListedInShop stays the "live right now" flag the shop reads.
CREATE TYPE "ShopStatus" AS ENUM ('UNPUBLISHED', 'DRAFT', 'PUBLISHED');

ALTER TABLE "InvProduct"
    ADD COLUMN "shopStatus" "ShopStatus" NOT NULL DEFAULT 'UNPUBLISHED',
    ADD COLUMN "copyDraftJson" JSONB,
    ADD COLUMN "copyDraftAt" TIMESTAMP(3);

-- Every product live in the shop today stays live: PUBLISHED. The rest keep the
-- default UNPUBLISHED. updatedAt is bumped so counters pick the change up (only
-- the listed rows change — the rest already match the column default).
UPDATE "InvProduct" SET "shopStatus" = 'PUBLISHED', "updatedAt" = now() WHERE "isListedInShop" = true;

CREATE INDEX "InvProduct_shopStatus_idx" ON "InvProduct"("shopStatus");
