-- CRM → Reviews: a copy of the shop's public reviews (Google first), and the
-- shop's reply. New table only: nothing existing changes.
CREATE TABLE "Review" (
    "id" SERIAL NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "reviewerName" TEXT,
    "reviewerPhoto" TEXT,
    "stars" INTEGER,
    "comment" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "replyText" TEXT,
    "repliedAt" TIMESTAMP(3),
    "repliedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Review_platform_externalId_key" ON "Review"("platform", "externalId");
CREATE INDEX "Review_platform_reviewedAt_idx" ON "Review"("platform", "reviewedAt");
