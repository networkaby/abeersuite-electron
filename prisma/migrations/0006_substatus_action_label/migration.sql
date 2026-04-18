-- Add actionLabel column to TicketSubStatus
ALTER TABLE "TicketSubStatus" ADD COLUMN "actionLabel" TEXT;

-- Seed action labels for sub-statuses that notify roles (Front Desk / Despatch)
UPDATE "TicketSubStatus" SET "actionLabel" = 'Call customer — needs to provide information'    WHERE id = 'SS1';
UPDATE "TicketSubStatus" SET "actionLabel" = 'Call customer — needs to bring item'             WHERE id = 'SS2';
UPDATE "TicketSubStatus" SET "actionLabel" = 'Call customer — quote ready for approval'        WHERE id = 'SS5';
UPDATE "TicketSubStatus" SET "actionLabel" = 'Inform customer — parts delayed'                 WHERE id = 'SS11';
UPDATE "TicketSubStatus" SET "actionLabel" = 'Inform customer — parts issue, decision needed'  WHERE id = 'SS12';
UPDATE "TicketSubStatus" SET "actionLabel" = 'Notify customer — device is ready to collect'    WHERE id = 'SS15';
UPDATE "TicketSubStatus" SET "actionLabel" = 'Call customer — partial fix, decision needed'    WHERE id = 'SS17';
UPDATE "TicketSubStatus" SET "actionLabel" = 'Call customer — beyond economical repair'        WHERE id = 'SS32';
UPDATE "TicketSubStatus" SET "actionLabel" = 'Pack device and arrange courier to service centre' WHERE id = 'SS22';
UPDATE "TicketSubStatus" SET "actionLabel" = 'Await incoming delivery from service centre'     WHERE id = 'SS27';
