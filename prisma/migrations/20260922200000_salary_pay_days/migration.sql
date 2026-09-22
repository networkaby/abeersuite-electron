-- Salary is for 26 days a month (the government rule), not for the calendar
-- month. The divisor lives on each revision so a contract can say otherwise,
-- and is frozen onto a payroll run line the way every other figure there is.
ALTER TABLE "staff_salaries"   ADD COLUMN "payDays" INTEGER NOT NULL DEFAULT 26;
ALTER TABLE "payroll_run_lines" ADD COLUMN "payDays" INTEGER NOT NULL DEFAULT 26;
