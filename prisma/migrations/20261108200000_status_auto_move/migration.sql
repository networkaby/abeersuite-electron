-- A status can move a ticket on by itself (owner, 2026-11-08): left in the status
-- for autoMoveAfterDays days, the ticket moves to autoMoveToId — e.g. Resolved →
-- Closed after 7 days ("no repeat complaint = fixed"). Both null = never.
ALTER TABLE "TicketStatus" ADD COLUMN "autoMoveAfterDays" INTEGER;
ALTER TABLE "TicketStatus" ADD COLUMN "autoMoveToId" TEXT;

ALTER TABLE "TicketStatus" ADD CONSTRAINT "TicketStatus_autoMoveToId_fkey"
    FOREIGN KEY ("autoMoveToId") REFERENCES "TicketStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE;
