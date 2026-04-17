-- CreateTable SubStatusTransition
CREATE TABLE "SubStatusTransition" (
    "id"               SERIAL  NOT NULL,
    "fromSubStatusId"  TEXT,
    "toSubStatusId"    TEXT NOT NULL,

    CONSTRAINT "SubStatusTransition_pkey" PRIMARY KEY ("id")
);

-- Unique constraint (null-safe: two rows both with null fromSubStatusId are distinct by toSubStatusId)
CREATE UNIQUE INDEX "SubStatusTransition_fromSubStatusId_toSubStatusId_key"
    ON "SubStatusTransition"("fromSubStatusId", "toSubStatusId");

-- AddForeignKey → TicketSubStatus (from)
ALTER TABLE "SubStatusTransition" ADD CONSTRAINT "SubStatusTransition_fromSubStatusId_fkey"
    FOREIGN KEY ("fromSubStatusId") REFERENCES "TicketSubStatus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey → TicketSubStatus (to)
ALTER TABLE "SubStatusTransition" ADD CONSTRAINT "SubStatusTransition_toSubStatusId_fkey"
    FOREIGN KEY ("toSubStatusId")   REFERENCES "TicketSubStatus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
