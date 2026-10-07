-- CreateTable
CREATE TABLE "Message" (
    "id" SERIAL NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "direction" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "senderName" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'text',
    "body" TEXT NOT NULL,
    "externalId" TEXT,
    "replyToExternalId" TEXT,
    "billKind" TEXT,
    "billRefId" INTEGER,
    "ticketId" INTEGER,
    "sentByUserId" INTEGER,
    "status" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "error" TEXT,
    "seenAt" TIMESTAMP(3),
    "spam" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Message_externalId_key" ON "Message"("externalId");

-- CreateIndex
CREATE INDEX "Message_phone_occurredAt_idx" ON "Message"("phone", "occurredAt");

-- CreateIndex
CREATE INDEX "Message_occurredAt_idx" ON "Message"("occurredAt");

-- CreateIndex
CREATE INDEX "Message_ticketId_idx" ON "Message"("ticketId");

-- CreateIndex
CREATE INDEX "Message_updatedAt_idx" ON "Message"("updatedAt");
