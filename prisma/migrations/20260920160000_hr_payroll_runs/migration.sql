-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" SERIAL NOT NULL,
    "periodMonth" DATE NOT NULL,
    "postingDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "voucherId" INTEGER,
    "voucherRef" TEXT,
    "note" TEXT,
    "grossPaise" INTEGER NOT NULL DEFAULT 0,
    "deductionsPaise" INTEGER NOT NULL DEFAULT 0,
    "netPaise" INTEGER NOT NULL DEFAULT 0,
    "headcount" INTEGER NOT NULL DEFAULT 0,
    "createdById" INTEGER NOT NULL,
    "postedById" INTEGER,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_run_lines" (
    "id" SERIAL NOT NULL,
    "runId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "staffName" TEXT NOT NULL,
    "salaryId" INTEGER,
    "effectiveFrom" DATE,
    "linesJson" JSONB NOT NULL,
    "grossPaise" INTEGER NOT NULL DEFAULT 0,
    "deductionsPaise" INTEGER NOT NULL DEFAULT 0,
    "netPaise" INTEGER NOT NULL DEFAULT 0,
    "ledgerAccountId" INTEGER,
    "expenseAccountId" INTEGER,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "skipReason" TEXT,

    CONSTRAINT "payroll_run_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_periodMonth_key" ON "payroll_runs"("periodMonth");

-- CreateIndex
CREATE INDEX "payroll_runs_status_idx" ON "payroll_runs"("status");

-- CreateIndex
CREATE INDEX "payroll_runs_updatedAt_idx" ON "payroll_runs"("updatedAt");

-- CreateIndex
CREATE INDEX "payroll_run_lines_userId_idx" ON "payroll_run_lines"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_run_lines_runId_userId_key" ON "payroll_run_lines"("runId", "userId");

-- AddForeignKey
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_runId_fkey" FOREIGN KEY ("runId") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

