-- CreateTable TicketSubStatus
CREATE TABLE "TicketSubStatus" (
    "id"                  TEXT NOT NULL,
    "label"               TEXT NOT NULL,
    "color"               TEXT NOT NULL DEFAULT 'bg-gray-100 text-gray-600',
    "group"               TEXT NOT NULL,
    "order"               INTEGER NOT NULL,
    "applicableStatusIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "allowedRoles"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "notifyRoles"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "triggerStatusId"     TEXT,

    CONSTRAINT "TicketSubStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable Notification
CREATE TABLE "Notification" (
    "id"        SERIAL NOT NULL,
    "userId"    INTEGER NOT NULL,
    "ticketId"  INTEGER NOT NULL,
    "message"   TEXT NOT NULL,
    "type"      TEXT NOT NULL,
    "read"      BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- AlterTable Ticket
ALTER TABLE "Ticket" ADD COLUMN "subStatusId"    TEXT;
ALTER TABLE "Ticket" ADD COLUMN "escalationType" TEXT;

-- AlterTable TicketLog
ALTER TABLE "TicketLog" ADD COLUMN "subStatusId" TEXT;

-- AddForeignKey TicketSubStatus → TicketStatus (trigger)
ALTER TABLE "TicketSubStatus" ADD CONSTRAINT "TicketSubStatus_triggerStatusId_fkey"
    FOREIGN KEY ("triggerStatusId") REFERENCES "TicketStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey Ticket → TicketSubStatus
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_subStatusId_fkey"
    FOREIGN KEY ("subStatusId") REFERENCES "TicketSubStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey TicketLog → TicketSubStatus
ALTER TABLE "TicketLog" ADD CONSTRAINT "TicketLog_subStatusId_fkey"
    FOREIGN KEY ("subStatusId") REFERENCES "TicketSubStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey Notification → User
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey Notification → Ticket
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
