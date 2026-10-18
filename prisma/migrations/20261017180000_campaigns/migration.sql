-- Campaigns (2026-10-17): the place to write a message for many customers at
-- once — a greeting or an offer, optionally carrying an existing coupon. Phase 1
-- only stores campaigns; sending (push, later WhatsApp) comes next.
-- prisma/schema/campaigns.prisma.
--
-- RELEASE GATE: the table syncs to the counters, so every till must run the
-- build that carries it BEFORE the d_office push applies this migration
-- (AGENTS.md §3). No data to carry.

-- CreateTable
CREATE TABLE "Campaign" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'PUSH',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT,
    "couponId" INTEGER,
    "audience" TEXT NOT NULL DEFAULT 'ALL_PUSH',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sentAt" TIMESTAMP(3),
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Campaign_status_createdAt_idx" ON "Campaign"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Campaign_couponId_idx" ON "Campaign"("couponId");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
