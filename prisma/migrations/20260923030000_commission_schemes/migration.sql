-- Targets & Commission — a global scheme, a per-person mode, dated schemes made
-- of several rules paid together.
--
-- Additive. Owner, 2026-09-22: "earnings, commission, target, etc. need a page
-- to set/edit. user need to see it to get motivated." and "global commission,
-- user wise off/on and override, multiple target/commission type same time."
-- A scheme with userId NULL is the shop's global one; payroll freezes what a
-- period earned onto payroll_run_lines.commissionPaise.
ALTER TABLE "staff_profiles" ADD COLUMN "commissionMode" TEXT NOT NULL DEFAULT 'GLOBAL';

CREATE TABLE "commission_schemes" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "effectiveFrom" DATE NOT NULL,
    "rulesJson" JSONB NOT NULL,
    "note" TEXT,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_schemes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "commission_schemes_userId_effectiveFrom_key" ON "commission_schemes"("userId", "effectiveFrom");
-- NULLs are distinct to a unique index, so the global schemes need their own.
CREATE UNIQUE INDEX "commission_schemes_global_effectiveFrom_key" ON "commission_schemes"("effectiveFrom") WHERE "userId" IS NULL;
CREATE INDEX "commission_schemes_updatedAt_idx" ON "commission_schemes"("updatedAt");

ALTER TABLE "commission_schemes" ADD CONSTRAINT "commission_schemes_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "staff_profiles"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
