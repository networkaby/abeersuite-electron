-- DropIndex
DROP INDEX "BillNotification_refId_key";

-- CreateIndex
CREATE UNIQUE INDEX "BillNotification_kind_refId_key" ON "BillNotification"("kind", "refId");

