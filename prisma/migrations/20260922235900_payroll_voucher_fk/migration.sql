-- PayrollRun.voucherId becomes a real relation to the journal it posted.
--
-- ON DELETE SET NULL, never CASCADE: deleting a journal voucher must not take
-- the payroll history with it. It only breaks the pointer, and `voucherRef`
-- (a plain string, untouched here) keeps saying which voucher it was — that
-- pair, a null id beside a set ref, IS the "voucher removed" state the payroll
-- screens now warn about.
--
-- Any pointer already dangling — a voucher hard-deleted before this migration —
-- is cleared first, or the constraint cannot be created at all.

-- Clear pointers to vouchers that no longer exist.
UPDATE "payroll_runs" r
   SET "voucherId" = NULL
 WHERE r."voucherId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "UniversalVoucher" v WHERE v."id" = r."voucherId");

-- CreateIndex
CREATE INDEX "payroll_runs_voucherId_idx" ON "payroll_runs"("voucherId");

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "UniversalVoucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;
