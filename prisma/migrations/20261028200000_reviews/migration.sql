-- CRM → Reviews: a copy of the shop's public reviews (Google first), the
-- shop's reply and an agent's draft; and Settings → Incoming API, one row per
-- outside caller. New tables only: nothing existing changes.
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
    "draftText" TEXT,
    "draftByName" TEXT,
    "draftedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Review_platform_externalId_key" ON "Review"("platform", "externalId");
CREATE INDEX "Review_platform_reviewedAt_idx" ON "Review"("platform", "reviewedAt");

CREATE TABLE "IncomingApi" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "secretEnc" TEXT,
    "secretHint" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "lastUsedAt" TIMESTAMP(3),
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncomingApi_pkey" PRIMARY KEY ("id")
);

-- The shop's Facebook Page connection (one row), so posts go to Facebook by
-- themselves. New table only: nothing existing changes.
CREATE TABLE "FacebookPageLink" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "userTokenEnc" TEXT NOT NULL,
    "fbUserName" TEXT,
    "pageId" TEXT,
    "pageName" TEXT,
    "pageTokenEnc" TEXT,
    "igUserId" TEXT,
    "igUsername" TEXT,
    "connectedById" INTEGER,
    "connectedByName" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacebookPageLink_pkey" PRIMARY KEY ("id")
);
