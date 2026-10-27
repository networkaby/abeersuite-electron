-- The shop's Google Business Profile connection (one row), so posts go to
-- Google by themselves. New table only: nothing existing changes.
CREATE TABLE "GoogleBusinessLink" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "refreshTokenEnc" TEXT NOT NULL,
    "googleEmail" TEXT,
    "accountName" TEXT,
    "locationName" TEXT,
    "locationTitle" TEXT,
    "connectedById" INTEGER,
    "connectedByName" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleBusinessLink_pkey" PRIMARY KEY ("id")
);
