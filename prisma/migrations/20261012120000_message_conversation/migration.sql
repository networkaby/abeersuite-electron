-- One row per conversation with a customer number (topic: asking / ticket / new).
CREATE TABLE "MessageConversation" (
    "id" SERIAL NOT NULL,
    "phone" TEXT NOT NULL,
    "topic" TEXT NOT NULL DEFAULT 'NEW',
    "ticketId" INTEGER,
    "menuTicketIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closedReason" TEXT,
    "closedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageConversation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MessageConversation_phone_closedAt_idx" ON "MessageConversation"("phone", "closedAt");
CREATE INDEX "MessageConversation_ticketId_idx" ON "MessageConversation"("ticketId");
CREATE INDEX "MessageConversation_updatedAt_idx" ON "MessageConversation"("updatedAt");

-- Each message's conversation. Old rows stay null.
ALTER TABLE "Message" ADD COLUMN "conversationId" INTEGER;
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");
