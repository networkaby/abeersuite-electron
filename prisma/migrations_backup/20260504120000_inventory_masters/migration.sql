-- Inventory master tables (no stock quantities; transactions live elsewhere)

CREATE TABLE "InvUnit" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvUnit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvUnit_code_key" ON "InvUnit"("code");

CREATE TABLE "InvCategory" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "parentId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvCategory_slug_key" ON "InvCategory"("slug");
CREATE INDEX "InvCategory_parentId_idx" ON "InvCategory"("parentId");

ALTER TABLE "InvCategory" ADD CONSTRAINT "InvCategory_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "InvCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "InvProductGroup" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvProductGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvProductGroup_name_key" ON "InvProductGroup"("name");

CREATE TABLE "InvBrand" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvBrand_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvBrand_name_key" ON "InvBrand"("name");

CREATE TABLE "InvWarrantyTerm" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "durationMonths" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvWarrantyTerm_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InvProduct" (
    "id" SERIAL NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitId" INTEGER NOT NULL,
    "categoryId" INTEGER,
    "groupId" INTEGER,
    "brandId" INTEGER,
    "warrantyTermId" INTEGER,
    "modelNo" TEXT,
    "barcode1" TEXT,
    "barcode2" TEXT,
    "barcode3" TEXT,
    "ean1" TEXT,
    "ean2" TEXT,
    "ean3" TEXT,
    "upc1" TEXT,
    "upc2" TEXT,
    "upc3" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvProduct_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvProduct_sku_key" ON "InvProduct"("sku");
CREATE INDEX "InvProduct_unitId_idx" ON "InvProduct"("unitId");
CREATE INDEX "InvProduct_categoryId_idx" ON "InvProduct"("categoryId");
CREATE INDEX "InvProduct_groupId_idx" ON "InvProduct"("groupId");
CREATE INDEX "InvProduct_brandId_idx" ON "InvProduct"("brandId");
CREATE INDEX "InvProduct_warrantyTermId_idx" ON "InvProduct"("warrantyTermId");

ALTER TABLE "InvProduct" ADD CONSTRAINT "InvProduct_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "InvUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvProduct" ADD CONSTRAINT "InvProduct_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "InvCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InvProduct" ADD CONSTRAINT "InvProduct_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "InvProductGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InvProduct" ADD CONSTRAINT "InvProduct_brandId_fkey"
    FOREIGN KEY ("brandId") REFERENCES "InvBrand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InvProduct" ADD CONSTRAINT "InvProduct_warrantyTermId_fkey"
    FOREIGN KEY ("warrantyTermId") REFERENCES "InvWarrantyTerm"("id") ON DELETE SET NULL ON UPDATE CASCADE;
