-- CreateTable
CREATE TABLE "CrmLead" (
    "id" SERIAL NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "companyName" TEXT,
    "valuePaise" INTEGER,
    "source" TEXT,
    "notes" TEXT,
    "customerId" INTEGER,
    "companyId" INTEGER,
    "ownerUserId" INTEGER,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmLead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CrmLead_pipelineId_status_idx" ON "CrmLead"("pipelineId", "status");
CREATE INDEX "CrmLead_ownerUserId_idx" ON "CrmLead"("ownerUserId");
CREATE INDEX "CrmLead_createdAt_idx" ON "CrmLead"("createdAt");

ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_status_fkey" FOREIGN KEY ("status") REFERENCES "TicketStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
