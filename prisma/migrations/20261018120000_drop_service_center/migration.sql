-- Service centres are Sundry-Creditor parties (Account), picked by both the
-- shipping slip and Escalate and kept on Ticket.context. The old standalone
-- ServiceCenter list goes. Owner confirmed no tickets exist, so nothing to carry.
-- Dropping is counter-safe: a replica with a spare column/table never halts.
ALTER TABLE "TicketRepair" DROP CONSTRAINT IF EXISTS "TicketRepair_serviceCenterId_fkey";
DROP INDEX IF EXISTS "TicketRepair_serviceCenterId_idx";
ALTER TABLE "TicketRepair" DROP COLUMN IF EXISTS "serviceCenterId";
DROP TABLE IF EXISTS "ServiceCenter";
