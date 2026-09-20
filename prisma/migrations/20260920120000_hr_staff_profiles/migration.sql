-- HR & People — the staff member's HR record and salary revisions.
--
-- Staff = User + HR rows: no separate employee table. `staff_profiles` is one row
-- per User (employment dates, personal / KYC, bank, and two ledger links —
-- the person's own "Salary Payable" ledger and the expense ledger their payroll
-- will debit). `staff_salaries` holds dated salary revisions; the structure in
-- force on a date is the latest row with effectiveFrom <= date.
--
-- Additive only: no existing table, column or row changes. The "Salary Payable"
-- account group is master data and comes from the seed, not from here.

-- CreateTable
CREATE TABLE "staff_profiles" (
    "userId" INTEGER NOT NULL,
    "staffCode" TEXT,
    "joinedOn" DATE,
    "leftOn" DATE,
    "leftReason" TEXT,
    "employmentType" TEXT NOT NULL DEFAULT 'FULL_TIME',
    "weeklyOff" INTEGER[] DEFAULT ARRAY[0]::INTEGER[],
    "fatherName" TEXT,
    "address" TEXT,
    "bloodGroup" TEXT,
    "emergencyName" TEXT,
    "emergencyPhone" TEXT,
    "aadhaarLast4" VARCHAR(4),
    "panNumber" VARCHAR(10),
    "uanNumber" VARCHAR(12),
    "esiNumber" VARCHAR(17),
    "bankJson" JSONB,
    "notes" TEXT,
    "ledgerAccountId" INTEGER,
    "expenseAccountId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_profiles_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "staff_salaries" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "linesJson" JSONB NOT NULL,
    "grossPaise" INTEGER NOT NULL,
    "netPaise" INTEGER NOT NULL,
    "note" TEXT,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_salaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_profiles_staffCode_key" ON "staff_profiles"("staffCode");

-- CreateIndex
CREATE UNIQUE INDEX "staff_profiles_ledgerAccountId_key" ON "staff_profiles"("ledgerAccountId");

-- CreateIndex
CREATE INDEX "staff_profiles_leftOn_idx" ON "staff_profiles"("leftOn");

-- CreateIndex
CREATE INDEX "staff_profiles_expenseAccountId_idx" ON "staff_profiles"("expenseAccountId");

-- CreateIndex
CREATE INDEX "staff_profiles_updatedAt_idx" ON "staff_profiles"("updatedAt");

-- CreateIndex
CREATE INDEX "staff_salaries_updatedAt_idx" ON "staff_salaries"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "staff_salaries_userId_effectiveFrom_key" ON "staff_salaries"("userId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_salaries" ADD CONSTRAINT "staff_salaries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "staff_profiles"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
