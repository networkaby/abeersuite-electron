-- DropForeignKey
ALTER TABLE "staff_profiles" DROP CONSTRAINT "staff_profiles_expenseAccountId_fkey";

-- DropIndex
DROP INDEX "staff_profiles_expenseAccountId_idx";

-- AlterTable
ALTER TABLE "payroll_run_lines" DROP COLUMN "expenseAccountId";

-- AlterTable
ALTER TABLE "payroll_runs" ADD COLUMN     "expenseAccountId" INTEGER;

-- AlterTable
ALTER TABLE "staff_profiles" DROP COLUMN "expenseAccountId";

-- CreateIndex
CREATE INDEX "payroll_runs_expenseAccountId_idx" ON "payroll_runs"("expenseAccountId");

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

