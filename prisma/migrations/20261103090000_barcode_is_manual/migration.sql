-- The barcode price is now always stored (barcodeManualPaise = the saved barcode ₹).
-- barcodeIsManual says whether it was typed by hand (violet) or made from the bands.
ALTER TABLE "InvProduct" ADD COLUMN "barcodeIsManual" BOOLEAN NOT NULL DEFAULT false;

-- Every barcode stored before this release was typed by hand.
UPDATE "InvProduct" SET "barcodeIsManual" = true, "updatedAt" = NOW()
WHERE "barcodeManualPaise" IS NOT NULL;
