-- Group pricing (Pricing Strategy -> Group pricing), POS only.
--
-- A customer group now carries a small price list: one row per product group
-- saying how that group's items are billed for its customers (MRP, printed
-- barcode price, a share of the profit left, or a % off), plus three ticks
-- for which automatic benefits (tier discount, coupons, loyalty) the group
-- may get. CustomerGroup gains `updatedAt` so every save changes its row: the
-- counter replica pulls this table whole when its content changes, and the
-- price rules ride along as its child set.
--
-- Idempotent: a replica may already carry these from local-schema.sql.

DO $$ BEGIN
    CREATE TYPE "GroupPriceType" AS ENUM ('MRP', 'PRINT_PRICE', 'PROFIT_SHARE', 'REVENUE_DISCOUNT');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "CustomerGroup" ADD COLUMN IF NOT EXISTS "allowCoupons" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "allowLoyalty" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "allowTierDiscount" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS "CustomerGroupPriceRule" (
    "id" SERIAL NOT NULL,
    "customerGroupId" INTEGER NOT NULL,
    "productGroupId" INTEGER,
    "priceType" "GroupPriceType" NOT NULL,
    "pct" DECIMAL(5,2),

    CONSTRAINT "CustomerGroupPriceRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CustomerGroupPriceRule_productGroupId_idx" ON "CustomerGroupPriceRule"("productGroupId");

CREATE UNIQUE INDEX IF NOT EXISTS "CustomerGroupPriceRule_customerGroupId_productGroupId_key" ON "CustomerGroupPriceRule"("customerGroupId", "productGroupId");

DO $$ BEGIN
    ALTER TABLE "CustomerGroupPriceRule" ADD CONSTRAINT "CustomerGroupPriceRule_customerGroupId_fkey" FOREIGN KEY ("customerGroupId") REFERENCES "CustomerGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "CustomerGroupPriceRule" ADD CONSTRAINT "CustomerGroupPriceRule_productGroupId_fkey" FOREIGN KEY ("productGroupId") REFERENCES "InvProductGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
