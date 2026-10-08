-- Who is handling a customer's WhatsApp chat (owner + invited helpers).
CREATE TABLE "MessageClaim" (
    "phone" TEXT NOT NULL,
    "ownerUserId" INTEGER NOT NULL,
    "helperUserIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageClaim_pkey" PRIMARY KEY ("phone")
);

CREATE INDEX "MessageClaim_updatedAt_idx" ON "MessageClaim"("updatedAt");
