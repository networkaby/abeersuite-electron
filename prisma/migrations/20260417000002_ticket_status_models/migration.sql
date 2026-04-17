-- Create TicketStatus lookup table
CREATE TABLE "TicketStatus" (
    "id"         TEXT NOT NULL,
    "label"      TEXT NOT NULL,
    "color"      TEXT NOT NULL,
    "order"      INTEGER NOT NULL,
    "isTerminal" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "TicketStatus_pkey" PRIMARY KEY ("id")
);

-- Seed default statuses (must exist before FK constraints below)
INSERT INTO "TicketStatus" ("id", "label", "color", "order", "isTerminal") VALUES
    ('S1', 'Received',         'bg-gray-100 text-gray-600',     1, false),
    ('S2', 'Diagnosing',       'bg-blue-100 text-blue-600',     2, false),
    ('S3', 'Repairing',        'bg-yellow-100 text-yellow-600', 3, false),
    ('S4', 'Escalated',        'bg-orange-100 text-orange-600', 4, false),
    ('S5', 'Received Back',    'bg-purple-100 text-purple-600', 5, false),
    ('S6', 'Ready for Pickup', 'bg-green-100 text-green-600',   6, false),
    ('S7', 'Returned',         'bg-gray-100 text-gray-400',     7, true);

-- Add FK from Ticket and TicketLog to TicketStatus
ALTER TABLE "Ticket"
    ADD CONSTRAINT "Ticket_status_fkey"
    FOREIGN KEY ("status") REFERENCES "TicketStatus"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TicketLog"
    ADD CONSTRAINT "TicketLog_status_fkey"
    FOREIGN KEY ("status") REFERENCES "TicketStatus"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Create StatusTransition table
CREATE TABLE "StatusTransition" (
    "id"           SERIAL NOT NULL,
    "fromStatusId" TEXT NOT NULL,
    "toStatusId"   TEXT NOT NULL,
    CONSTRAINT "StatusTransition_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "StatusTransition"
    ADD CONSTRAINT "StatusTransition_fromStatusId_fkey"
    FOREIGN KEY ("fromStatusId") REFERENCES "TicketStatus"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StatusTransition"
    ADD CONSTRAINT "StatusTransition_toStatusId_fkey"
    FOREIGN KEY ("toStatusId") REFERENCES "TicketStatus"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "StatusTransition_fromStatusId_toStatusId_key"
    ON "StatusTransition"("fromStatusId", "toStatusId");

-- Seed default transitions
INSERT INTO "StatusTransition" ("fromStatusId", "toStatusId") VALUES
    ('S1', 'S2'),           -- Received      → Diagnosing
    ('S2', 'S3'),           -- Diagnosing    → Repairing
    ('S2', 'S4'),           -- Diagnosing    → Escalated
    ('S3', 'S6'),           -- Repairing     → Ready for Pickup
    ('S3', 'S4'),           -- Repairing     → Escalated
    ('S4', 'S5'),           -- Escalated     → Received Back
    ('S5', 'S3'),           -- Received Back → Repairing
    ('S5', 'S6'),           -- Received Back → Ready for Pickup
    ('S6', 'S7'),           -- Ready         → Returned
    ('S7', 'S1');           -- Returned      → Received (reopen)
