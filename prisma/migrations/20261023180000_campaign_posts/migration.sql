-- Campaigns → regular posts (owner, 2026-10-23: "separate a marketing campaigns,
-- other things like Google business profile post update … whatsapp channel,
-- status … these are regular post"). A Post is written once and put up on
-- several channels; PostShare logs each channel it went out on and who did it.
-- WhatsApp Status / Channel have no posting API and Google Business Profile has
-- none until its API access is approved, so those are shared by hand from a
-- phone or browser and logged here. A post may belong to a campaign.
--
-- RELEASE GATE: new tables sync to the counters, so every till must run the
-- build that carries them BEFORE the d_office push applies this (AGENTS.md §3).

-- CreateTable
CREATE TABLE "Post" (
    "id" SERIAL NOT NULL,
    "caption" TEXT NOT NULL,
    "link" TEXT,
    "channels" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "googleType" TEXT NOT NULL DEFAULT 'UPDATE',
    "googleButton" TEXT,
    "mediaKey" TEXT,
    "mediaType" TEXT,
    "mediaName" TEXT,
    "mediaSize" INTEGER,
    "campaignId" INTEGER,
    "createdById" INTEGER,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostShare" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "sharedById" INTEGER,
    "sharedByName" TEXT,
    "sharedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Post_status_scheduledAt_idx" ON "Post"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Post_campaignId_idx" ON "Post"("campaignId");

-- CreateIndex
CREATE INDEX "PostShare_postId_sharedAt_idx" ON "PostShare"("postId", "sharedAt");

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostShare" ADD CONSTRAINT "PostShare_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- sync-touch: PostShare -> Post (a share line must bump the post's updatedAt, or
-- it never reaches a counter replica; see 20261012230000_sync_touch_parent).
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "PostShare";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "PostShare"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('postId', 'Post', 'id', 'updatedAt');
