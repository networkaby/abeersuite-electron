-- Campaigns: a photo / video per campaign for WhatsApp Status and Channel, and a
-- log of where staff put it up by hand (owner, 2026-10-23). Meta's API cannot post
-- a Status or a Channel update, so the office prepares the file and caption and a
-- phone shares it; CampaignPost records that it was done.
--
-- RELEASE GATE: a new table and new columns sync to the counters, so every till
-- must run the build that carries them BEFORE the d_office push applies this
-- (AGENTS.md §3).

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "mediaKey" TEXT,
ADD COLUMN     "mediaName" TEXT,
ADD COLUMN     "mediaSize" INTEGER,
ADD COLUMN     "mediaType" TEXT;

-- CreateTable
CREATE TABLE "CampaignPost" (
    "id" SERIAL NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "place" TEXT NOT NULL,
    "postedById" INTEGER,
    "postedByName" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignPost_campaignId_postedAt_idx" ON "CampaignPost"("campaignId", "postedAt");

-- AddForeignKey
ALTER TABLE "CampaignPost" ADD CONSTRAINT "CampaignPost_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
