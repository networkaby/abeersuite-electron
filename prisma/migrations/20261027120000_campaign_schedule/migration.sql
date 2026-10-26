-- A campaign can be scheduled instead of sent at once: status SCHEDULED plus the
-- time it goes. The 30-minute communications job sends it at the first run on or
-- after scheduledAt. Nullable: existing campaigns keep NULL.
ALTER TABLE "Campaign" ADD COLUMN "scheduledAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Campaign_status_scheduledAt_idx" ON "Campaign"("status", "scheduledAt");
