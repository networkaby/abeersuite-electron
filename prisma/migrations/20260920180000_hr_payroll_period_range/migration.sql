-- DropIndex
DROP INDEX "payroll_runs_periodMonth_key";

-- AlterTable
ALTER TABLE "payroll_run_lines" ADD COLUMN     "paidDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "periodDays" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payroll_runs" DROP COLUMN "periodMonth",
ADD COLUMN     "periodFrom" DATE NOT NULL,
ADD COLUMN     "periodTo" DATE NOT NULL;

-- CreateIndex
CREATE INDEX "payroll_runs_periodFrom_idx" ON "payroll_runs"("periodFrom");

-- CreateIndex
CREATE INDEX "payroll_runs_periodTo_idx" ON "payroll_runs"("periodTo");

