-- The month's attendance, accounted and frozen with the pay.
--
-- Additive. A slip prints from its own posted line so it says the same thing
-- in ten years; the day-by-day working under the pay heads has to be frozen the
-- same way, or a day edited later would quietly change a slip already handed
-- out. Lines from before this carry NULL and print without the section.
ALTER TABLE "payroll_run_lines" ADD COLUMN "attendanceJson" JSONB;

-- Print template: the salary slip's attendance section, A4 + thermal.
ALTER TABLE "VoucherPrintTemplate" ADD COLUMN "showAttendance" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "VoucherPrintTemplate" ADD COLUMN "showAttendanceThermal" BOOLEAN NOT NULL DEFAULT true;
