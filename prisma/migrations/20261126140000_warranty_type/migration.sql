-- Warranty type (owner, 2026-11-26). A warranty term says who honours it —
-- the shop (SELLER), the brand (MANUFACTURER), the shop first then the brand
-- (COMBINED, with sellerDays), or NONE. Each sale line freezes the product's
-- term id at sale time so a reprint keeps the warranty it was sold with. The
-- condition text per type lives on the print template; a term may add its own.

CREATE TYPE "WarrantyType" AS ENUM ('SELLER', 'MANUFACTURER', 'COMBINED', 'NONE');

ALTER TABLE "InvWarrantyTerm"
    ADD COLUMN "warrantyType"   "WarrantyType" NOT NULL DEFAULT 'SELLER',
    ADD COLUMN "sellerDays"     INTEGER,
    ADD COLUMN "extraCondition" TEXT;

-- Existing terms are the shop's own support period (2026-10-21 rule) → SELLER
-- by the default above. A term with no duration named "No …" is no warranty.
-- updatedAt is bumped so the counters pull the change.
UPDATE "InvWarrantyTerm"
   SET "warrantyType" = 'NONE', "updatedAt" = CURRENT_TIMESTAMP
 WHERE COALESCE("durationDays", 0) = 0
   AND lower(trim("name")) IN ('no', 'no warranty', 'none', 'nil');

ALTER TABLE "VoucherInventoryLine" ADD COLUMN "warrantyTermId" INTEGER;
CREATE INDEX "VoucherInventoryLine_warrantyTermId_idx" ON "VoucherInventoryLine"("warrantyTermId");
ALTER TABLE "VoucherInventoryLine" ADD CONSTRAINT "VoucherInventoryLine_warrantyTermId_fkey"
    FOREIGN KEY ("warrantyTermId") REFERENCES "InvWarrantyTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VoucherPrintTemplate"
    ADD COLUMN "showWarranty"             BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "showWarrantyThermal"      BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "warrantySellerText"       TEXT NOT NULL DEFAULT '',
    ADD COLUMN "warrantyManufacturerText" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "warrantyCombinedText"     TEXT NOT NULL DEFAULT '',
    ADD COLUMN "warrantyNoneText"         TEXT NOT NULL DEFAULT '';

-- Starting condition text on the three customer sale bills (editable in
-- Settings → Print templates). Same wording as buildVoucherTemplateDefaults.
UPDATE "VoucherPrintTemplate"
   SET "warrantySellerText"       = 'Bring the item with this bill to our shop. Physical, liquid and burn damage not covered.',
       "warrantyManufacturerText" = 'Claim at the brand''s authorised service centre with this bill.',
       "warrantyCombinedText"     = 'During the seller period bring the item with this bill to our shop; after that, claim at the brand''s authorised service centre.',
       "updatedAt"                = CURRENT_TIMESTAMP
 WHERE "kind" IN ('SALE', 'POS', 'ONLINE_INVOICE');
