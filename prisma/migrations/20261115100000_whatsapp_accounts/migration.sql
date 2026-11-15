-- WhatsApp numbers stand on their own (owner, 2026-11-15): one record per
-- number (Cloud only or coexistence), each with its own ids and optional token;
-- template approval is per WhatsApp account, so a new account is approved
-- before bills move to it.
-- The app fills both tables on first read from the old settings (the ids may
-- live only in .env): the OTP / bills numbers become records, and the old single
-- approval on "WhatsAppTemplate" is copied to the bills account.

CREATE TABLE "WhatsAppNumber" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'CLOUD',
    "phone" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "accountLabel" TEXT NOT NULL,
    "token" TEXT,
    "useForOtp" BOOLEAN NOT NULL DEFAULT false,
    "useForBills" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'Not tested',
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsAppNumber_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppNumber_phoneNumberId_key" ON "WhatsAppNumber"("phoneNumberId");

CREATE TABLE "WhatsAppTemplateApproval" (
    "kind" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "metaName" TEXT,
    "metaId" TEXT,
    "rejectReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "approvedName" TEXT,
    "approvedBody" TEXT,
    "approvedView" TEXT,
    "approvedApp" TEXT,
    "approvedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsAppTemplateApproval_pkey" PRIMARY KEY ("kind","wabaId")
);
