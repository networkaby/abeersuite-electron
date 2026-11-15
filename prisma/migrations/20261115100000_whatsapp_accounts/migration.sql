-- WhatsApp accounts stand on their own (owner, 2026-11-15): every account we
-- send from is listed, and each template is approved per account, so a new
-- account (coexistence) is approved before bills move to it.
-- The old single approval on "WhatsAppTemplate" is copied into the new table by
-- the app on first read (it needs the bills account id, which may live in .env).

CREATE TABLE "WhatsAppAccount" (
    "wabaId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsAppAccount_pkey" PRIMARY KEY ("wabaId")
);

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
