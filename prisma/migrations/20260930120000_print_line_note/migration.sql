-- Print template: show the goods line's note (serial no., colour, config)
-- under the item name — an A4 flag and a Thermal flag like every other
-- element, both on by default. Idempotent: a counter replica may already
-- carry the columns from local-schema.sql.
ALTER TABLE "VoucherPrintTemplate" ADD COLUMN IF NOT EXISTS "showLineNote" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "VoucherPrintTemplate" ADD COLUMN IF NOT EXISTS "showLineNoteThermal" BOOLEAN NOT NULL DEFAULT true;
