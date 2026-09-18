-- Bank reconciliation — the bank's statement, kept.
--
-- Three satellite tables. The posting spine (UniversalVoucher / VoucherGlLine) is
-- untouched: a match points at a GL line by a LOOSE id, no foreign key, the same
-- way VoucherAllocation and VoucherLink point at their targets. A voucher whose
-- lines were rewritten or removed leaves a match the read path reports as stale
-- and auto-match clears.
--
-- Additive only: no existing table, column or row changes.

CREATE TABLE "BankStatementImport" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" VARCHAR(40) NOT NULL,
    "profile" TEXT NOT NULL,
    "bankAccountNumber" TEXT,
    "ifsc" TEXT,
    "fromDate" DATE,
    "toDate" DATE,
    "openingBalance" DECIMAL(14,2),
    "closingBalance" DECIMAL(14,2),
    "lineCount" INTEGER NOT NULL,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "beforeLock" INTEGER NOT NULL DEFAULT 0,
    "importedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatementImport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BankStatementLine" (
    "id" SERIAL NOT NULL,
    "importId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "narration" TEXT NOT NULL,
    "reference" TEXT,
    "withdrawal" DECIMAL(14,2),
    "deposit" DECIMAL(14,2),
    "balance" DECIMAL(14,2),
    "fingerprint" VARCHAR(40) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatementLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BankStatementMatch" (
    "id" SERIAL NOT NULL,
    "groupId" TEXT NOT NULL,
    "statementLineId" INTEGER NOT NULL,
    "glLineId" INTEGER NOT NULL,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatementMatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BankStatementImport_accountId_createdAt_idx" ON "BankStatementImport"("accountId", "createdAt");

CREATE UNIQUE INDEX "BankStatementLine_accountId_fingerprint_key" ON "BankStatementLine"("accountId", "fingerprint");
CREATE INDEX "BankStatementLine_accountId_date_idx" ON "BankStatementLine"("accountId", "date");
CREATE INDEX "BankStatementLine_importId_idx" ON "BankStatementLine"("importId");

CREATE UNIQUE INDEX "BankStatementMatch_statementLineId_glLineId_key" ON "BankStatementMatch"("statementLineId", "glLineId");
CREATE INDEX "BankStatementMatch_glLineId_idx" ON "BankStatementMatch"("glLineId");
CREATE INDEX "BankStatementMatch_groupId_idx" ON "BankStatementMatch"("groupId");

ALTER TABLE "BankStatementImport" ADD CONSTRAINT "BankStatementImport_importedById_fkey"
    FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Removing an upload removes its lines, and a removed line takes its matches with it.
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_importId_fkey"
    FOREIGN KEY ("importId") REFERENCES "BankStatementImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BankStatementMatch" ADD CONSTRAINT "BankStatementMatch_statementLineId_fkey"
    FOREIGN KEY ("statementLineId") REFERENCES "BankStatementLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BankStatementMatch" ADD CONSTRAINT "BankStatementMatch_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
