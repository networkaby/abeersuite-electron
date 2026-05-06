-- Phase 2: ecommerce admin — ShopCoupon, order workflow fields, ticket link
-- NOTE: ShopOrderStatus, ShopOrder, ShopProduct, ShopOrderLine were originally
-- created directly in the DB (not tracked). Added here as IF NOT EXISTS so the
-- shadow DB can replay the full migration history cleanly.

DO $$ BEGIN
    CREATE TYPE "ShopOrderStatus" AS ENUM ('DRAFT', 'PENDING_PAYMENT', 'PAID', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ShopProduct" (
    "id"               SERIAL NOT NULL,
    "name"             TEXT NOT NULL,
    "slug"             TEXT,
    "subheading"       TEXT,
    "description"      TEXT,
    "category"         TEXT,
    "pricePaise"       INTEGER,
    "mrpPaise"         INTEGER,
    "badge"            TEXT,
    "imageUrl"         TEXT,
    "galleryJson"      JSONB,
    "specsJson"        JSONB,
    "stock"            INTEGER,
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 5,
    "isActive"         BOOLEAN NOT NULL DEFAULT true,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShopProduct_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShopProduct_slug_key" ON "ShopProduct"("slug");

CREATE TABLE IF NOT EXISTS "ShopOrder" (
    "id"                SERIAL NOT NULL,
    "status"            "ShopOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "customerId"        INTEGER,
    "accountId"         INTEGER,
    "guestEmail"        TEXT,
    "guestPhone"        TEXT,
    "totalPaise"        INTEGER NOT NULL DEFAULT 0,
    "razorpayOrderId"   TEXT,
    "razorpayPaymentId" TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShopOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShopOrder_razorpayOrderId_key" ON "ShopOrder"("razorpayOrderId");
CREATE INDEX IF NOT EXISTS "ShopOrder_customerId_idx" ON "ShopOrder"("customerId");
CREATE INDEX IF NOT EXISTS "ShopOrder_accountId_idx" ON "ShopOrder"("accountId");
CREATE INDEX IF NOT EXISTS "ShopOrder_status_idx" ON "ShopOrder"("status");

CREATE TABLE IF NOT EXISTS "ShopOrderLine" (
    "id"             SERIAL NOT NULL,
    "orderId"        INTEGER NOT NULL,
    "productId"      INTEGER NOT NULL,
    "quantity"       INTEGER NOT NULL DEFAULT 1,
    "unitPricePaise" INTEGER NOT NULL,
    CONSTRAINT "ShopOrderLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ShopOrderLine_orderId_idx"   ON "ShopOrderLine"("orderId");
CREATE INDEX IF NOT EXISTS "ShopOrderLine_productId_idx" ON "ShopOrderLine"("productId");

DO $$
BEGIN
    ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_customerId_fkey"
        FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_accountId_fkey"
        FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "ShopOrderLine" ADD CONSTRAINT "ShopOrderLine_orderId_fkey"
        FOREIGN KEY ("orderId") REFERENCES "ShopOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "ShopOrderLine" ADD CONSTRAINT "ShopOrderLine_productId_fkey"
        FOREIGN KEY ("productId") REFERENCES "ShopProduct"("id") ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

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
