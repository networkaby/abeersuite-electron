-- A status can message the customer when a ticket enters it (owner,
-- 2026-11-08): one WhatsApp template and one email template, both optional.
ALTER TABLE "TicketStatus" ADD COLUMN "waTemplate" TEXT;
ALTER TABLE "TicketStatus" ADD COLUMN "emailTemplate" TEXT;
