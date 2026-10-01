-- Batch 3b database clean-up (2026-10-02). Runs on Supabase only.
--
-- RELEASE GATE: every till must run the build that carries this migration
-- BEFORE the d_office push applies it. A replica keeps every column it was
-- ever given and ships whole rows; only that build strips columns the office
-- no longer has (SyncRegistryEntry.columns), so an older till would have its
-- voucher uploads held in its queue until it updates. Idempotent throughout.

-- 1. Voucher soft-delete columns. Soft-delete was retired 2026-08-01; nothing
-- has written these since, and every filter on them was always true.
DROP INDEX IF EXISTS "UniversalVoucher_deletedAt_idx";
ALTER TABLE "UniversalVoucher" DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE "UniversalVoucher" DROP COLUMN IF EXISTS "deletedById";
ALTER TABLE "UniversalVoucher" DROP COLUMN IF EXISTS "deleteReason";

-- 2. The series-level running number. The number has lived per counter in
-- VoucherSeriesCounter since 2026-09; the series row only mirrored counter 1's
-- for the Year Ending page, which now reads the counter rows. A series the office
-- numbered before its counter-1 row existed carries the number across first.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'VoucherSeries' AND column_name = 'nextSeq') THEN
        INSERT INTO "VoucherSeriesCounter" ("kind", "counterNumber", "nextSeq", "fyStartYear", "resetGen", "updatedAt")
        SELECT s."kind", 1, s."nextSeq", s."fyStartYear", s."resetGen", CURRENT_TIMESTAMP
        FROM "VoucherSeries" s
        WHERE s."nextSeq" > 0
        ON CONFLICT ("kind", "counterNumber") DO NOTHING;
    END IF;
END $$;
ALTER TABLE "VoucherSeries" DROP COLUMN IF EXISTS "nextSeq";

-- 3. The line note gets its own column. Until now POS stored a goods line as
-- "<sku> — <name> · <note>" and the office form stored the note alone in
-- `description`; every reader split the text back apart, and a product whose
-- name contains " · " lost part of its name into the note.
ALTER TABLE "VoucherInventoryLine" ADD COLUMN IF NOT EXISTS "note" TEXT;

-- One-time split of existing lines - only where it is certain, which is exactly
-- what the print-time split (`splitLineDescription`) already showed:
--   a) POS text that starts with the product's own "<sku> — <name> · ": the rest
--      is the note and the text keeps "<sku> — <name>";
--   b) text that is not the "<sku> — " form and is not the product name: the
--      whole text was the note (office form, free-item marker).
-- Anything else (a product renamed since the sale, a name split elsewhere) is
-- left as it is and still reads through the old split. Lines already carrying a
-- note are never touched, so a re-run changes nothing.
WITH cand AS (
    SELECT l.id, l."universalVoucherId", btrim(l."description") AS d,
           coalesce(p."sku", '') || ' — '                          AS item_prefix,
           coalesce(p."sku", '') || ' — ' || p."name"              AS item_text,
           coalesce(p."sku", '') || ' — ' || p."name" || ' · '     AS note_prefix,
           btrim(p."name")                                         AS pname
    FROM "VoucherInventoryLine" l
    JOIN "InvProduct" p ON p.id = l."productId"
    WHERE l."note" IS NULL AND btrim(coalesce(l."description", '')) <> ''
), plan AS (
    -- Exact prefix tests, not LIKE: a product name may contain % or _.
    SELECT id, "universalVoucherId",
           CASE WHEN left(d, length(note_prefix)) = note_prefix AND length(d) > length(note_prefix)
                THEN btrim(substr(d, length(note_prefix) + 1)) ELSE d END          AS new_note,
           CASE WHEN left(d, length(note_prefix)) = note_prefix AND length(d) > length(note_prefix)
                THEN item_text ELSE NULL END                                         AS new_description
    FROM cand
    WHERE (left(d, length(note_prefix)) = note_prefix AND length(d) > length(note_prefix))
       OR (left(d, length(item_prefix)) <> item_prefix AND d <> pname)
), split AS (
    UPDATE "VoucherInventoryLine" l
    SET "note" = plan.new_note, "description" = plan.new_description
    FROM plan
    WHERE l.id = plan.id AND plan.new_note <> ''
    RETURNING l."universalVoucherId"
)
-- VoucherInventoryLine has no updatedAt; tills re-pull a voucher's lines when
-- its spine moves.
UPDATE "UniversalVoucher" SET "updatedAt" = CURRENT_TIMESTAMP
WHERE id IN (SELECT DISTINCT "universalVoucherId" FROM split);
