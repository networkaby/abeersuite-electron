-- CreateEnum
CREATE TYPE "VoucherType" AS ENUM ('CONTRA', 'PAYMENT', 'RECEIPT', 'CREDIT_NOTE', 'DEBIT_NOTE');

-- CreateEnum
CREATE TYPE "AllocationMethod" AS ENUM ('NEW_REF', 'AGAINST_REF', 'ADVANCE', 'ON_ACCOUNT');

-- CreateEnum
CREATE TYPE "AllocationTargetType" AS ENUM ('INVOICE', 'VOUCHER', 'JOURNAL_ENTRY');

-- CreateEnum
CREATE TYPE "AllocationSourceType" AS ENUM ('VOUCHER', 'PAYMENT', 'INVOICE', 'JOURNAL_ENTRY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InvVoucherType" ADD VALUE 'STOCK_JOURNAL';
ALTER TYPE "InvVoucherType" ADD VALUE 'PHYSICAL_STOCK';
ALTER TYPE "InvVoucherType" ADD VALUE 'GRN';
ALTER TYPE "InvVoucherType" ADD VALUE 'CHALLAN';
ALTER TYPE "InvVoucherType" ADD VALUE 'REJECTION_IN';
ALTER TYPE "InvVoucherType" ADD VALUE 'REJECTION_OUT';
ALTER TYPE "InvVoucherType" ADD VALUE 'SALES_ORDER';
ALTER TYPE "InvVoucherType" ADD VALUE 'PURCHASE_ORDER';

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "openingBalance" DECIMAL(14,2),
ADD COLUMN     "openingBalanceDate" DATE,
ADD COLUMN     "openingBalanceType" "EntryType";

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "booksBeginningFrom" DATE,
ADD COLUMN     "financialYearFrom" DATE;

-- AlterTable
ALTER TABLE "InvProduct" ADD COLUMN     "openingRate" DECIMAL(14,2),
ADD COLUMN     "openingStock" DECIMAL(10,3),
ADD COLUMN     "openingStockDate" DATE,
ADD COLUMN     "openingValue" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "InvVoucher" ADD COLUMN     "cancelledById" INTEGER,
ADD COLUMN     "deleteReason" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" INTEGER,
ADD COLUMN     "showPrices" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" INTEGER,
ADD COLUMN     "deleteReason" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" INTEGER;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" INTEGER,
ADD COLUMN     "deleteReason" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" INTEGER,
ADD COLUMN     "postedAt" TIMESTAMP(3),
ADD COLUMN     "status" "VoucherStatus" NOT NULL DEFAULT 'POSTED';

-- CreateTable
CREATE TABLE "InvoiceAudit" (
    "id" SERIAL NOT NULL,
    "originalId" INTEGER NOT NULL,
    "originalRef" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "snapshot" JSONB NOT NULL,
    "actorId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAudit" (
    "id" SERIAL NOT NULL,
    "originalId" INTEGER NOT NULL,
    "originalRef" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "snapshot" JSONB NOT NULL,
    "actorId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Voucher" (
    "id" SERIAL NOT NULL,
    "type" "VoucherType" NOT NULL,
    "reference" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "narration" TEXT,
    "partyAccountId" INTEGER,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "status" "VoucherStatus" NOT NULL DEFAULT 'DRAFT',
    "postedAt" TIMESTAMP(3),
    "journalEntryId" INTEGER,
    "createdById" INTEGER NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" INTEGER,
    "cancelReason" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedById" INTEGER,
    "deleteReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Voucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherLine" (
    "id" SERIAL NOT NULL,
    "voucherId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "type" "EntryType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT,

    CONSTRAINT "VoucherLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherAudit" (
    "id" SERIAL NOT NULL,
    "originalId" INTEGER NOT NULL,
    "originalRef" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "snapshot" JSONB NOT NULL,
    "actorId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoucherAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherAllocation" (
    "id" SERIAL NOT NULL,
    "targetType" "AllocationTargetType" NOT NULL,
    "targetId" INTEGER NOT NULL,
    "sourceType" "AllocationSourceType" NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "AllocationMethod" NOT NULL,
    "reference" TEXT,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoucherAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvVoucherAudit" (
    "id" SERIAL NOT NULL,
    "originalId" INTEGER NOT NULL,
    "originalRef" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "snapshot" JSONB NOT NULL,
    "actorId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvVoucherAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceAudit_originalId_idx" ON "InvoiceAudit"("originalId");

-- CreateIndex
CREATE INDEX "InvoiceAudit_actorId_idx" ON "InvoiceAudit"("actorId");

-- CreateIndex
CREATE INDEX "InvoiceAudit_createdAt_idx" ON "InvoiceAudit"("createdAt");

-- CreateIndex
CREATE INDEX "PaymentAudit_originalId_idx" ON "PaymentAudit"("originalId");

-- CreateIndex
CREATE INDEX "PaymentAudit_actorId_idx" ON "PaymentAudit"("actorId");

-- CreateIndex
CREATE INDEX "PaymentAudit_createdAt_idx" ON "PaymentAudit"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_reference_key" ON "Voucher"("reference");

-- CreateIndex
CREATE INDEX "Voucher_type_status_idx" ON "Voucher"("type", "status");

-- CreateIndex
CREATE INDEX "Voucher_date_idx" ON "Voucher"("date");

-- CreateIndex
CREATE INDEX "Voucher_deletedAt_idx" ON "Voucher"("deletedAt");

-- CreateIndex
CREATE INDEX "Voucher_partyAccountId_idx" ON "Voucher"("partyAccountId");

-- CreateIndex
CREATE INDEX "VoucherLine_voucherId_idx" ON "VoucherLine"("voucherId");

-- CreateIndex
CREATE INDEX "VoucherLine_accountId_idx" ON "VoucherLine"("accountId");

-- CreateIndex
CREATE INDEX "VoucherAudit_originalId_idx" ON "VoucherAudit"("originalId");

-- CreateIndex
CREATE INDEX "VoucherAudit_actorId_idx" ON "VoucherAudit"("actorId");

-- CreateIndex
CREATE INDEX "VoucherAudit_createdAt_idx" ON "VoucherAudit"("createdAt");

-- CreateIndex
CREATE INDEX "VoucherAllocation_targetType_targetId_idx" ON "VoucherAllocation"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "VoucherAllocation_sourceType_sourceId_idx" ON "VoucherAllocation"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "VoucherAllocation_method_idx" ON "VoucherAllocation"("method");

-- CreateIndex
CREATE INDEX "InvVoucherAudit_originalId_idx" ON "InvVoucherAudit"("originalId");

-- CreateIndex
CREATE INDEX "InvVoucherAudit_actorId_idx" ON "InvVoucherAudit"("actorId");

-- CreateIndex
CREATE INDEX "InvVoucherAudit_createdAt_idx" ON "InvVoucherAudit"("createdAt");

-- CreateIndex
CREATE INDEX "InvVoucher_deletedAt_idx" ON "InvVoucher"("deletedAt");

-- CreateIndex
CREATE INDEX "Invoice_deletedAt_idx" ON "Invoice"("deletedAt");

-- CreateIndex
CREATE INDEX "Payment_status_date_idx" ON "Payment"("status", "date");

-- CreateIndex
CREATE INDEX "Payment_deletedAt_idx" ON "Payment"("deletedAt");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceAudit" ADD CONSTRAINT "InvoiceAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAudit" ADD CONSTRAINT "PaymentAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_partyAccountId_fkey" FOREIGN KEY ("partyAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherLine" ADD CONSTRAINT "VoucherLine_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherLine" ADD CONSTRAINT "VoucherLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherAudit" ADD CONSTRAINT "VoucherAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherAllocation" ADD CONSTRAINT "VoucherAllocation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvVoucher" ADD CONSTRAINT "InvVoucher_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvVoucher" ADD CONSTRAINT "InvVoucher_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvVoucherAudit" ADD CONSTRAINT "InvVoucherAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
