-- Saved barcode (tag) price. See src/modules/pricing-strategy/lib/barcodeStore.ts.
-- barcodeManualPaise  = the saved barcode ₹ that is printed (null = never saved → derived live).
-- barcodeIsManual     = true when typed by hand (violet), false when made from the bands.
-- barcodeGapBasePaise = the effective sale price when the barcode was last saved (original gap basis).
ALTER TABLE "InvProduct" ADD COLUMN "barcodeManualPaise" INTEGER;
ALTER TABLE "InvProduct" ADD COLUMN "barcodeIsManual" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InvProduct" ADD COLUMN "barcodeGapBasePaise" INTEGER;
