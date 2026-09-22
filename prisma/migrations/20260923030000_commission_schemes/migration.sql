-- Targets & Commission — a catalogue of commission heads, a per-person override,
-- and the commission breakup frozen onto the payroll line.
--
-- Additive. Owner, 2026-09-22/23: "earnings, commission, target, etc. need a
-- page to set/edit. user need to see it to get motivated." — "in set
-- commission page is like coupon page here we create different commission or
-- target head its not user specific" — "user kind applicable" — "user wise
-- override %, per commission head".
CREATE TABLE "commission_heads" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL,
    "targetPaise" INTEGER NOT NULL DEFAULT 0,
    "rateBp" INTEGER NOT NULL DEFAULT 0,
    "slabsJson" JSONB,
    "bonusPaise" INTEGER NOT NULL DEFAULT 0,
    "unit" TEXT,
    "targetCount" INTEGER NOT NULL DEFAULT 0,
    "perUnitPaise" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "appliesTo" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_heads_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "commission_heads_active_idx" ON "commission_heads"("active");
CREATE INDEX "commission_heads_updatedAt_idx" ON "commission_heads"("updatedAt");

CREATE TABLE "commission_overrides" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "headId" INTEGER NOT NULL,
    "rateBp" INTEGER,
    "bonusPaise" INTEGER,
    "off" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_overrides_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "commission_overrides_userId_headId_key" ON "commission_overrides"("userId", "headId");
CREATE INDEX "commission_overrides_headId_idx" ON "commission_overrides"("headId");
ALTER TABLE "commission_overrides" ADD CONSTRAINT "commission_overrides_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "staff_profiles"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_overrides" ADD CONSTRAINT "commission_overrides_headId_fkey"
    FOREIGN KEY ("headId") REFERENCES "commission_heads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Things the app cannot see, typed in by HR against a MANUAL head.
CREATE TABLE "commission_entries" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "headId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "commission_entries_userId_headId_date_idx" ON "commission_entries"("userId", "headId", "date");
CREATE INDEX "commission_entries_headId_idx" ON "commission_entries"("headId");
CREATE INDEX "commission_entries_updatedAt_idx" ON "commission_entries"("updatedAt");
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "staff_profiles"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_headId_fkey"
    FOREIGN KEY ("headId") REFERENCES "commission_heads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The slip's commission working, frozen with the pay it explains.
ALTER TABLE "payroll_run_lines" ADD COLUMN "commissionJson" JSONB;

-- Print template: the salary slip's commission section, A4 + thermal.
ALTER TABLE "VoucherPrintTemplate" ADD COLUMN "showCommission" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "VoucherPrintTemplate" ADD COLUMN "showCommissionThermal" BOOLEAN NOT NULL DEFAULT true;
