-- The Round Off tick on a trading voucher, saved as the user left it so the bill
-- re-opens the same way. Nullable: existing rows keep NULL and the form falls back
-- to "non-zero round-off = ticked", which is how they open today.
ALTER TABLE "VoucherDetail" ADD COLUMN "roundOffOn" BOOLEAN;
