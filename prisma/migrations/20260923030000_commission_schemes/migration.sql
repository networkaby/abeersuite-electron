-- Targets & Commission — one dated scheme per person, revised like a salary.
--
-- Additive. Owner, 2026-09-22: "earnings, commission, target, etc. need a page
-- to set/edit. user need to see it to get motivated." The scheme says the
-- month's sales target and how the person's own posted sales turn into
-- commission; payroll freezes the answer onto payroll_run_lines.commissionPaise.
CREATE TABLE "commission_schemes" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "targetPaise" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL DEFAULT 'NONE',
    "rateBp" INTEGER NOT NULL DEFAULT 0,
    "slabsJson" JSONB,
    "bonusPaise" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_schemes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "commission_schemes_userId_effectiveFrom_key" ON "commission_schemes"("userId", "effectiveFrom");
CREATE INDEX "commission_schemes_updatedAt_idx" ON "commission_schemes"("updatedAt");

ALTER TABLE "commission_schemes" ADD CONSTRAINT "commission_schemes_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "staff_profiles"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
