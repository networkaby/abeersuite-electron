-- Manual barcode (tag) price override. null = auto-derive from the saved sale price.
ALTER TABLE "InvProduct" ADD COLUMN "barcodeManualPaise" INTEGER;
