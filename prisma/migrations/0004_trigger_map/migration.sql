-- Drop old FK constraint and column
ALTER TABLE "TicketSubStatus" DROP CONSTRAINT IF EXISTS "TicketSubStatus_triggerStatusId_fkey";
ALTER TABLE "TicketSubStatus" DROP COLUMN IF EXISTS "triggerStatusId";

-- Add per-parent trigger map (JSONB, default empty object)
ALTER TABLE "TicketSubStatus" ADD COLUMN "triggerMap" JSONB NOT NULL DEFAULT '{}';
