-- Merge ShopProduct into InvProduct.
-- Ecommerce fields are added as optional columns on InvProduct.
-- ShopOrderLine FK is re-targeted from ShopProduct → InvProduct.
-- ShopProduct table is dropped.

-- ── Step 1: Add ecommerce columns to InvProduct ───────────────────────────────
ALTER TABLE "InvProduct" ADD COLUMN "slug"              TEXT;
ALTER TABLE "InvProduct" ADD COLUMN "shopSubheading"    TEXT;
ALTER TABLE "InvProduct" ADD COLUMN "shopDescription"   TEXT;
ALTER TABLE "InvProduct" ADD COLUMN "shopCategory"      TEXT;
ALTER TABLE "InvProduct" ADD COLUMN "pricePaise"        INTEGER;
ALTER TABLE "InvProduct" ADD COLUMN "mrpPaise"          INTEGER;
ALTER TABLE "InvProduct" ADD COLUMN "shopBadge"         TEXT;
ALTER TABLE "InvProduct" ADD COLUMN "imageUrl"          TEXT;
ALTER TABLE "InvProduct" ADD COLUMN "galleryJson"       JSONB;
ALTER TABLE "InvProduct" ADD COLUMN "specsJson"         JSONB;
ALTER TABLE "InvProduct" ADD COLUMN "stock"             INTEGER;
ALTER TABLE "InvProduct" ADD COLUMN "lowStockThreshold" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "InvProduct" ADD COLUMN "isListedInShop"    BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "InvProduct_slug_key" ON "InvProduct"("slug");
CREATE INDEX "InvProduct_isListedInShop_idx" ON "InvProduct"("isListedInShop");

-- ── Step 2: Ensure a default PCS unit exists (needed for data migration) ──────
INSERT INTO "InvUnit" ("code", "label", "decimals", "isActive", "updatedAt")
    VALUES ('PCS', 'Piece', 0, true, NOW())
    ON CONFLICT ("code") DO NOTHING;

-- ── Step 3: Migrate ShopProduct rows → InvProduct ────────────────────────────
-- SKU = slug if available, else 'SP-<id>'
INSERT INTO "InvProduct" (
    "sku", "name", "unitId",
    "slug", "shopSubheading", "shopDescription", "shopCategory",
    "pricePaise", "mrpPaise", "shopBadge",
    "imageUrl", "galleryJson", "specsJson",
    "stock", "lowStockThreshold",
    "isActive", "isListedInShop",
    "updatedAt"
)
SELECT
    COALESCE(NULLIF(TRIM(sp."slug"), ''), 'SP-' || sp."id"::text),
    sp."name",
    (SELECT "id" FROM "InvUnit" WHERE "code" = 'PCS' LIMIT 1),
    sp."slug",
    sp."subheading",
    sp."description",
    sp."category",
    sp."pricePaise",
    sp."mrpPaise",
    sp."badge",
    sp."imageUrl",
    sp."galleryJson",
    sp."specsJson",
    sp."stock",
    sp."lowStockThreshold",
    sp."isActive",
    sp."isActive",
    NOW()
FROM "ShopProduct" sp
ON CONFLICT ("sku") DO NOTHING;

-- ── Step 4: Re-target ShopOrderLine.productId → InvProduct ───────────────────
ALTER TABLE "ShopOrderLine" DROP CONSTRAINT IF EXISTS "ShopOrderLine_productId_fkey";

-- Map old ShopProduct IDs to new InvProduct IDs
CREATE TEMP TABLE _shop_to_inv AS
SELECT sp."id" AS shop_id, ip."id" AS inv_id
FROM "ShopProduct" sp
JOIN "InvProduct" ip
  ON ip."sku" = COALESCE(NULLIF(TRIM(sp."slug"), ''), 'SP-' || sp."id"::text);

UPDATE "ShopOrderLine" sol
SET "productId" = m.inv_id
FROM _shop_to_inv m
WHERE sol."productId" = m.shop_id;

ALTER TABLE "ShopOrderLine"
    ADD CONSTRAINT "ShopOrderLine_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "InvProduct"("id");

-- ── Step 5: Drop ShopProduct ──────────────────────────────────────────────────
DROP TABLE "ShopProduct";

-- ── Step 6: TicketPart (repair parts tracking) ────────────────────────────────
CREATE TABLE "TicketPart" (
    "id"           SERIAL NOT NULL,
    "ticketId"     INTEGER NOT NULL,
    "invProductId" INTEGER NOT NULL,
    "quantity"     DOUBLE PRECISION NOT NULL DEFAULT 1,
    "notes"        TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketPart_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TicketPart_ticketId_idx"     ON "TicketPart"("ticketId");
CREATE INDEX "TicketPart_invProductId_idx" ON "TicketPart"("invProductId");

ALTER TABLE "TicketPart"
    ADD CONSTRAINT "TicketPart_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TicketPart"
    ADD CONSTRAINT "TicketPart_invProductId_fkey"
    FOREIGN KEY ("invProductId") REFERENCES "InvProduct"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
