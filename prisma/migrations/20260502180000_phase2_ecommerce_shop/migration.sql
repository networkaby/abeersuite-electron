-- Phase 2: ecommerce admin — ShopCoupon, order workflow fields, ticket link

CREATE TABLE "ShopCoupon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "percentOff" INTEGER,
    "flatPaise" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopCoupon_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShopCoupon_code_key" ON "ShopCoupon"("code");

-- New order statuses (append to existing enum)
ALTER TYPE "ShopOrderStatus" ADD VALUE IF NOT EXISTS 'PACKED';
ALTER TYPE "ShopOrderStatus" ADD VALUE IF NOT EXISTS 'SHIPPED';
ALTER TYPE "ShopOrderStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';
ALTER TYPE "ShopOrderStatus" ADD VALUE IF NOT EXISTS 'REFUNDED';

ALTER TABLE "ShopProduct" ADD COLUMN IF NOT EXISTS "stock" INTEGER;
ALTER TABLE "ShopProduct" ADD COLUMN IF NOT EXISTS "lowStockThreshold" INTEGER NOT NULL DEFAULT 5;

ALTER TABLE "ShopOrder" ADD COLUMN IF NOT EXISTS "shippingName" TEXT;
ALTER TABLE "ShopOrder" ADD COLUMN IF NOT EXISTS "shippingAddress" JSONB;
ALTER TABLE "ShopOrder" ADD COLUMN IF NOT EXISTS "courier" TEXT;
ALTER TABLE "ShopOrder" ADD COLUMN IF NOT EXISTS "trackingNumber" TEXT;
ALTER TABLE "ShopOrder" ADD COLUMN IF NOT EXISTS "sourceCouponId" TEXT;
ALTER TABLE "ShopOrder" ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3);
ALTER TABLE "ShopOrder" ADD COLUMN IF NOT EXISTS "packedAt" TIMESTAMP(3);
ALTER TABLE "ShopOrder" ADD COLUMN IF NOT EXISTS "shippedAt" TIMESTAMP(3);
ALTER TABLE "ShopOrder" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);
ALTER TABLE "ShopOrder" ADD COLUMN IF NOT EXISTS "refundedAt" TIMESTAMP(3);

DO $$
BEGIN
    ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_sourceCouponId_fkey"
        FOREIGN KEY ("sourceCouponId") REFERENCES "ShopCoupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "ShopOrder_sourceCouponId_idx" ON "ShopOrder"("sourceCouponId");

ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "sourceShopOrderId" INTEGER;

DO $$
BEGIN
    ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_sourceShopOrderId_fkey"
        FOREIGN KEY ("sourceShopOrderId") REFERENCES "ShopOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "Ticket_sourceShopOrderId_idx" ON "Ticket"("sourceShopOrderId");
