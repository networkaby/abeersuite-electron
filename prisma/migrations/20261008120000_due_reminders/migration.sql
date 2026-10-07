-- Due reminders: the automation settings (singleton), its rules, and the log of
-- every reminder sent or put on the owner's call list. New tables only.

-- CreateTable
CREATE TABLE "DueReminderSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sendTime" TEXT NOT NULL DEFAULT '10:00',
    "skipDays" INTEGER[] DEFAULT ARRAY[5]::INTEGER[],
    "dailyCap" INTEGER NOT NULL DEFAULT 50,
    "minBalance" DECIMAL(14,2) NOT NULL DEFAULT 100,
    "excludedAccountIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "lastRunDate" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DueReminderSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DueReminderRule" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "minDays" INTEGER NOT NULL,
    "minAmount" DECIMAL(14,2) NOT NULL,
    "repeatDays" INTEGER NOT NULL DEFAULT 0,
    "action" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DueReminderRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DueReminderLog" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "partyName" TEXT NOT NULL,
    "personId" INTEGER,
    "amount" DECIMAL(14,2) NOT NULL,
    "action" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "ruleId" INTEGER,
    "mobile" TEXT,
    "pushStatus" TEXT NOT NULL,
    "waStatus" TEXT NOT NULL,
    "waMessageId" TEXT,
    "waError" TEXT,
    "sentById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DueReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DueReminderLog_accountId_createdAt_idx" ON "DueReminderLog"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "DueReminderLog_createdAt_idx" ON "DueReminderLog"("createdAt");

-- The three rules the owner signed off on (2026-10-07), so the page is not empty.
INSERT INTO "DueReminderRule" ("name", "minDays", "minAmount", "repeatDays", "action", "sortOrder") VALUES
    ('Gentle',    7,  500,   0,  'SOFT',      0),
    ('Firm',      30, 2000,  15, 'FIRM',      1),
    ('Big & old', 60, 10000, 0,  'CALL_LIST', 2);
