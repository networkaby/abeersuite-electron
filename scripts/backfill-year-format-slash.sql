-- Switch every voucher series from "Fiscal short (26-27)" to "Fiscal short (26/27)".
--
-- Settings only: bill numbers already issued keep their dash. Only numbers made
-- after this run come out as ...-26/27 (owner's call, 2026-10-01).
--
-- RUN ONLY AFTER every counter is on the release that knows FY_SHORT_SLASH.
-- An older till falls back to the plain year (2026) for a format it does not know.
--
-- Safe to run repeatedly: it only touches rows still on FY_SHORT.

-- 1. See what will flip.
SELECT kind, label, "yearFormat" FROM "VoucherSeries" WHERE "yearFormat" = 'FY_SHORT' ORDER BY kind;

-- 2. Flip them.
UPDATE "VoucherSeries" SET "yearFormat" = 'FY_SHORT_SLASH', "updatedAt" = now()
WHERE "yearFormat" = 'FY_SHORT';
