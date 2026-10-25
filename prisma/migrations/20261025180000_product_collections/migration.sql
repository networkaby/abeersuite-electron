-- A product may sit in several Collections (InvCategory). The join table is the
-- list; InvProduct."categoryId" stays as the MAIN collection (sortOrder 0) so
-- pricing, loyalty, coupons, POS and reports keep one bucket per product.
CREATE TABLE "inv_product_collections" (
    "productId" INTEGER NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "inv_product_collections_pkey" PRIMARY KEY ("productId","categoryId")
);

CREATE INDEX "inv_product_collections_categoryId_idx" ON "inv_product_collections"("categoryId");

ALTER TABLE "inv_product_collections" ADD CONSTRAINT "inv_product_collections_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InvProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inv_product_collections" ADD CONSTRAINT "inv_product_collections_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "InvCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry every product's current collection over as its main one. The table syncs
-- `full`, so tills pick these rows up without a parent touch.
INSERT INTO "inv_product_collections" ("productId", "categoryId", "sortOrder")
SELECT "id", "categoryId", 0 FROM "InvProduct" WHERE "categoryId" IS NOT NULL;
