-- Manual barcode (tag) price override. null = auto-derive from the saved sale price.
ALTER TABLE "InvProduct" ADD COLUMN "barcodeManualPaise" INTEGER;
-- Effective sale price when the barcode was last saved (original barcode gap basis).
ALTER TABLE "InvProduct" ADD COLUMN "barcodeGapBasePaise" INTEGER;
