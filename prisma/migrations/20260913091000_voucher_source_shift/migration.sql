-- The POS shift moves ONTO the voucher, and the two side tables that used to
-- hold it are dropped.
--
-- pos_receipts / pos_expenditures each carried a copy of the voucher (amount,
-- account, note, creator, timestamp) whose only non-duplicate column was the
-- shift link. Because that link lived outside the voucher, deleting a voucher
-- left the row behind: it kept showing on the counter's Payment/Receipt tab with
-- a dash for a reference, and kept counting toward the shift's expenditure
-- figure. POS sales, meanwhile, had no shift link at all and were attributed by
-- a createdAt time window.
--
-- One column on the voucher replaces all of it. Order matters: add the column,
-- carry every existing link onto it, then drop the tables.

-- ── 1. The column ────────────────────────────────────────────────────────────
ALTER TABLE "UniversalVoucher" ADD COLUMN "sourceShiftId" INTEGER;
CREATE INDEX "UniversalVoucher_sourceShiftId_idx" ON "UniversalVoucher"("sourceShiftId");

-- ── 2. Carry the existing links over ─────────────────────────────────────────
-- Exact, one row per link: these tables named their voucher.
UPDATE "UniversalVoucher" u
   SET "sourceShiftId" = r."shiftId"
  FROM "pos_receipts" r
 WHERE r."voucherId" = u."id";

UPDATE "UniversalVoucher" u
   SET "sourceShiftId" = e."shiftId"
  FROM "pos_expenditures" e
 WHERE e."voucherId" = u."id";

-- Which order an advance was collected against. Until now this was recoverable
-- only from the note text; carried onto a real link before the table goes.
INSERT INTO "VoucherLink" ("universalVoucherId", "kind", "targetId")
SELECT r."voucherId", 'ADVANCE_FOR', o."id"::text
  FROM "pos_receipts" r
  JOIN "UniversalVoucher" o
    ON o."voucherNo" = substring(r."note" from 'Advance against (.*)$')
   AND o."type" = 'POS_ORDER'
 WHERE r."voucherId" IS NOT NULL
   AND r."note" LIKE 'Advance against %'
ON CONFLICT ("universalVoucherId", "kind") DO NOTHING;

-- Everything else a counter raised — sales, returns, drops-to-safe, the opening
-- and closing contras. These never had a link, so the only evidence is the
-- shift that was standing at that counter when the voucher was written. An
-- approximation for history, and the last time one is needed: every voucher
-- from here on is stamped at creation.
UPDATE "UniversalVoucher" u
   SET "sourceShiftId" = (
         SELECT s."id"
           FROM "pos_shifts" s
          WHERE s."counterId" = u."sourceCounterId"
            AND COALESCE(u."sourceCreatedAt", u."createdAt") >= s."openedAt"
            AND COALESCE(u."sourceCreatedAt", u."createdAt") <= COALESCE(s."closedAt", NOW())
          ORDER BY s."openedAt" DESC
          LIMIT 1
       )
 WHERE u."sourceShiftId" IS NULL
   AND u."sourceCounterId" IS NOT NULL;

-- ── 3. Drop the side tables ──────────────────────────────────────────────────
ALTER TABLE "pos_expenditures" DROP CONSTRAINT "pos_expenditures_shiftId_fkey";
ALTER TABLE "pos_receipts" DROP CONSTRAINT "pos_receipts_shiftId_fkey";
DROP TABLE "pos_expenditures";
DROP TABLE "pos_receipts";
