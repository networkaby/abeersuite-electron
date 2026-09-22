-- Attendance spans - one row per ACTIVE STRETCH of a working day.
--
-- Purely additive: nothing existing is touched. AttendanceDay keeps its running
-- total and stays the row the register, grading and payroll read; these rows are
-- the ledger behind that balance, and they are what lets the breakup say how many
-- times somebody was active and when.
--
-- No back-fill. A span written from an old day's firstInAt/lastOutAt would be an
-- invented single stretch, not a record, and the sheet says "not tracked in
-- detail" for days before this instead of showing a fiction.

-- CreateTable
CREATE TABLE "attendance_spans" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "counterId" INTEGER,
    "endedBy" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_spans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_spans_userId_date_idx" ON "attendance_spans"("userId", "date");

-- CreateIndex
CREATE INDEX "attendance_spans_date_idx" ON "attendance_spans"("date");

-- CreateIndex
CREATE INDEX "attendance_spans_updatedAt_idx" ON "attendance_spans"("updatedAt");

-- AddForeignKey
ALTER TABLE "attendance_spans" ADD CONSTRAINT "attendance_spans_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Room for commission on a payroll line.
--
-- Additive and inert: every existing line reads 0, and 0 is exactly what the
-- generator writes until a Commission page exists to say otherwise. The amount
-- is ALSO carried as an ordinary "Commission" earning inside linesJson when it
-- is non-zero, so grossPaise/netPaise, the payslip and the journal already
-- account for it; this column is only so a sheet need not parse the JSON.
ALTER TABLE "payroll_run_lines" ADD COLUMN "commissionPaise" INTEGER NOT NULL DEFAULT 0;
