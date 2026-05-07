/*
  Warnings:

  - You are about to drop the `TicketPart` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "GstRegType" AS ENUM ('REGULAR', 'COMPOSITION', 'SEZ', 'UNREGISTERED');

-- CreateEnum
CREATE TYPE "Taxability" AS ENUM ('TAXABLE', 'EXEMPT', 'NIL_RATED', 'NON_GST');

-- DropForeignKey
ALTER TABLE "TicketPart" DROP CONSTRAINT "TicketPart_invProductId_fkey";

-- DropForeignKey
ALTER TABLE "TicketPart" DROP CONSTRAINT "TicketPart_ticketId_fkey";

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "gstRegType" "GstRegType",
ADD COLUMN     "gstStateCode" TEXT,
ADD COLUMN     "gstin" TEXT;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "gstRegType" "GstRegType",
ADD COLUMN     "gstStateCode" TEXT,
ADD COLUMN     "gstin" TEXT;

-- AlterTable
ALTER TABLE "InvProduct" ADD COLUMN     "gstRate" DECIMAL(5,2),
ADD COLUMN     "hsnCode" TEXT,
ADD COLUMN     "taxability" "Taxability";

-- AlterTable
ALTER TABLE "InvVoucher" ADD COLUMN     "placeOfSupply" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "ticketId" INTEGER;

-- DropTable
DROP TABLE "TicketPart";

-- CreateIndex
CREATE INDEX "Invoice_ticketId_idx" ON "Invoice"("ticketId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
