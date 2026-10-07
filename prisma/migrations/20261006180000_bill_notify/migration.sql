-- CreateTable
CREATE TABLE "WhatsAppTemplate" (
    "kind" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "viewButton" TEXT,
    "appButton" TEXT,
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

    CONSTRAINT "WhatsAppTemplate_pkey" PRIMARY KEY ("kind")
);

-- CreateTable
CREATE TABLE "BillNotification" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" INTEGER NOT NULL,
    "personId" INTEGER,
    "mobile" TEXT,
    "pushStatus" TEXT NOT NULL,
    "pushMessageId" TEXT,
    "waStatus" TEXT NOT NULL,
    "waMessageId" TEXT,
    "waError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillNotification_refId_key" ON "BillNotification"("refId");

-- CreateIndex
CREATE INDEX "BillNotification_personId_createdAt_idx" ON "BillNotification"("personId", "createdAt");

