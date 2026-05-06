-- CreateEnum
CREATE TYPE "OverrideType" AS ENUM ('GRANT', 'DENY');

-- CreateEnum
CREATE TYPE "UserScope" AS ENUM ('OWN', 'TEAM', 'DEPARTMENT', 'BRANCH', 'REGION', 'ORG');

-- CreateEnum
CREATE TYPE "WarrantyStatus" AS ENUM ('NONE', 'ACTIVE', 'VOID', 'CLAIMED');

-- CreateEnum
CREATE TYPE "EscalationType" AS ENUM ('INTERNAL', 'EXTERNAL', 'VENDOR');

-- CreateEnum
CREATE TYPE "LogVisibility" AS ENUM ('INTERNAL', 'CUSTOMER', 'PUBLIC');

-- CreateEnum
CREATE TYPE "GroupType" AS ENUM ('ASSET', 'LIABILITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "GlAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "NormalBalance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "VoucherStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EntryType" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIAL', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'MOBILE_PAYMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "InvVoucherType" AS ENUM ('PURCHASE', 'SALE', 'ESTIMATE', 'RECEIPT', 'ISSUE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('ONLINE', 'IN_STORE', 'PHONE', 'WHATSAPP', 'OTHER');

-- CreateEnum
CREATE TYPE "ChatRoomType" AS ENUM ('SYSTEM_INBOX', 'PERSONAL_INBOX', 'ROLE_GROUP', 'ORG_GROUP', 'DIRECT_MESSAGE');

-- CreateEnum
CREATE TYPE "ChatMessageType" AS ENUM ('SYSTEM', 'USER');

-- CreateEnum
CREATE TYPE "ShopOrderStatus" AS ENUM ('DRAFT', 'PENDING_PAYMENT', 'PAID', 'PACKED', 'SHIPPED', 'DELIVERED', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateTable
CREATE TABLE "AccountGroup" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" "GroupType" NOT NULL,
    "parentId" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AccountGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "type" "GlAccountType",
    "normalBalance" "NormalBalance",
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "parentId" INTEGER,
    "groupId" INTEGER,
    "customerId" INTEGER,
    "companyId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "agreedToTerms" BOOLEAN NOT NULL DEFAULT false,
    "agreedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "companyReg" TEXT,
    "taxId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerCompany" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "companyId" INTEGER NOT NULL,
    "role" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlinkedAt" TIMESTAMP(3),

    CONSTRAINT "CustomerCompany_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "reference" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "VoucherStatus" NOT NULL DEFAULT 'DRAFT',
    "postedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "cancelledById" INTEGER,
    "deletedAt" TIMESTAMP(3),
    "deletedById" INTEGER,
    "deleteReason" TEXT,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntryAudit" (
    "id" SERIAL NOT NULL,
    "originalId" INTEGER NOT NULL,
    "originalRef" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "snapshot" JSONB NOT NULL,
    "actorId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntryAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" SERIAL NOT NULL,
    "journalEntryId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "type" "EntryType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issueDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "notes" TEXT,
    "accountId" INTEGER,
    "shopOrderId" INTEGER,
    "partyName" TEXT,
    "partyType" TEXT,
    "partyId" INTEGER,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "amountPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" SERIAL NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" SERIAL NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "date" DATE NOT NULL,
    "notes" TEXT,
    "journalEntryId" INTEGER,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatRoom" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" "ChatRoomType" NOT NULL,
    "name" TEXT NOT NULL,
    "ownerUserId" INTEGER,
    "roleId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatRoomMember" (
    "id" SERIAL NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadAt" TIMESTAMP(3),

    CONSTRAINT "ChatRoomMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" SERIAL NOT NULL,
    "roomId" TEXT NOT NULL,
    "senderUserId" INTEGER,
    "messageType" "ChatMessageType" NOT NULL DEFAULT 'USER',
    "title" TEXT,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvUnit" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvCategory" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "parentId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvProductGroup" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvProductGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvBrand" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvBrand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvWarrantyTerm" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "durationMonths" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvWarrantyTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvProduct" (
    "id" SERIAL NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitId" INTEGER NOT NULL,
    "categoryId" INTEGER,
    "groupId" INTEGER,
    "brandId" INTEGER,
    "warrantyTermId" INTEGER,
    "modelNo" TEXT,
    "barcode1" TEXT,
    "barcode2" TEXT,
    "barcode3" TEXT,
    "ean1" TEXT,
    "ean2" TEXT,
    "ean3" TEXT,
    "upc1" TEXT,
    "upc2" TEXT,
    "upc3" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "slug" TEXT,
    "shopSubheading" TEXT,
    "shopDescription" TEXT,
    "shopCategory" TEXT,
    "pricePaise" INTEGER,
    "mrpPaise" INTEGER,
    "shopBadge" TEXT,
    "imageUrl" TEXT,
    "galleryJson" JSONB,
    "specsJson" JSONB,
    "stock" INTEGER,
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 5,
    "isListedInShop" BOOLEAN NOT NULL DEFAULT false,
    "costPaise" INTEGER,

    CONSTRAINT "InvProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvVoucher" (
    "id" SERIAL NOT NULL,
    "type" "InvVoucherType" NOT NULL,
    "reference" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "status" "VoucherStatus" NOT NULL DEFAULT 'DRAFT',
    "partyName" TEXT,
    "partyType" TEXT,
    "partyId" INTEGER,
    "partyPhone" TEXT,
    "partyAddress" TEXT,
    "paymentMode" TEXT,
    "discountPct" DECIMAL(5,2),
    "discountAmt" DECIMAL(14,2),
    "shippingAmt" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "roundOff" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "amountReceived" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "journalEntryId" INTEGER,
    "postedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvVoucherLine" (
    "id" SERIAL NOT NULL,
    "voucherId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(10,3) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountAmt" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "InvVoucherLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvStockLedger" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "voucherId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "inQty" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "outQty" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "rate" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "InvStockLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "branchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "branchId" TEXT,
    "departmentId" TEXT,
    "parentPostId" TEXT,
    "roleTemplateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPost" (
    "userId" INTEGER NOT NULL,
    "postId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPost_pkey" PRIMARY KEY ("userId","postId")
);

-- CreateTable
CREATE TABLE "Pipeline" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT 'bg-gray-100 text-gray-600',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketStatus" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "isTerminal" BOOLEAN NOT NULL DEFAULT false,
    "isEntryPoint" BOOLEAN NOT NULL DEFAULT false,
    "allowedRoles" TEXT[],
    "notifyRoles" TEXT[],
    "actionLabel" TEXT,
    "warrantyScope" TEXT NOT NULL DEFAULT 'any',
    "pipelineId" TEXT,

    CONSTRAINT "TicketStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketSubStatus" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'bg-gray-100 text-gray-600',
    "group" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "applicableStatusIds" TEXT[],
    "allowedRoles" TEXT[],
    "notifyRoles" TEXT[],
    "triggerMap" JSONB NOT NULL DEFAULT '{}',
    "actionLabel" TEXT,
    "autoRevertOnClear" BOOLEAN NOT NULL DEFAULT true,
    "handoffRole" TEXT,
    "warrantyScope" TEXT NOT NULL DEFAULT 'any',
    "groupId" TEXT,
    "pipelineId" TEXT,

    CONSTRAINT "TicketSubStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubStatusGroup" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SubStatusGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubStatusTransition" (
    "id" SERIAL NOT NULL,
    "fromSubStatusId" TEXT,
    "toSubStatusId" TEXT NOT NULL,

    CONSTRAINT "SubStatusTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusTransition" (
    "id" SERIAL NOT NULL,
    "fromStatusId" TEXT NOT NULL,
    "toStatusId" TEXT NOT NULL,

    CONSTRAINT "StatusTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPortalCredential" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "phoneNormalized" TEXT,
    "emailNormalized" TEXT,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerPortalCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "module" TEXT NOT NULL DEFAULT 'core',

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPermission" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "permissionId" TEXT NOT NULL,
    "type" "OverrideType" NOT NULL,
    "reason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "ShopCoupon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "percentOff" INTEGER,
    "flatPaise" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopCoupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopOrder" (
    "id" SERIAL NOT NULL,
    "status" "ShopOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "orderSource" "OrderSource" NOT NULL DEFAULT 'ONLINE',
    "pipelineId" TEXT,
    "statusId" TEXT,
    "accountId" INTEGER,
    "customerId" INTEGER,
    "guestEmail" TEXT,
    "guestPhone" TEXT,
    "shippingName" TEXT,
    "shippingAddress" JSONB,
    "totalPaise" INTEGER NOT NULL DEFAULT 0,
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "courier" TEXT,
    "trackingNumber" TEXT,
    "sourceCouponId" TEXT,
    "paidAt" TIMESTAMP(3),
    "packedAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopOrderLine" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPricePaise" INTEGER NOT NULL,

    CONSTRAINT "ShopOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WallPost" (
    "id" SERIAL NOT NULL,
    "wallUserId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WallPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "accountId" INTEGER,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" SERIAL NOT NULL,
    "sourceShopOrderId" INTEGER,
    "pipelineId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'S1',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "notes" TEXT,
    "accessInfo" TEXT,
    "estimatedCost" DOUBLE PRECISION,
    "deviceId" INTEGER NOT NULL,
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "escalatedAt" TIMESTAMP(3),
    "escalationType" "EscalationType",
    "expectedReturn" TIMESTAMP(3),
    "receivedBackAt" TIMESTAMP(3),
    "externalRef" TEXT,
    "serviceCenterId" INTEGER,
    "subStatusId" TEXT,
    "isWarranty" BOOLEAN NOT NULL DEFAULT false,
    "warrantyStatus" "WarrantyStatus" NOT NULL DEFAULT 'NONE',
    "warrantyRef" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "voidReason" TEXT,
    "primaryOwnerId" INTEGER,
    "billingAccountId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketParticipant" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "addedById" INTEGER NOT NULL,
    "addedForRole" TEXT,
    "addedBySubStatusId" TEXT,
    "removedAt" TIMESTAMP(3),
    "removedBySubStatusId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketLog" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "userId" INTEGER NOT NULL,
    "subStatusId" TEXT,
    "visibility" "LogVisibility" NOT NULL DEFAULT 'INTERNAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketPart" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "invProductId" INTEGER NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketPart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCenter" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceCenter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'R2',
    "title" TEXT,
    "scope" "UserScope" NOT NULL DEFAULT 'OWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "managerId" INTEGER,
    "avatarUrl" TEXT,
    "coverUrl" TEXT,
    "phone" TEXT,
    "birthday" TIMESTAMP(3),
    "bio" TEXT,
    "linkedIn" TEXT,
    "twitter" TEXT,
    "instagram" TEXT,
    "facebook" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_BranchToUser" (
    "A" TEXT NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_BranchToUser_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_DepartmentToUser" (
    "A" TEXT NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_DepartmentToUser_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "AccountGroup_parentId_sortOrder_idx" ON "AccountGroup"("parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "AccountGroup_type_idx" ON "AccountGroup"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Account_code_key" ON "Account"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Account_customerId_key" ON "Account"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_companyId_key" ON "Account"("companyId");

-- CreateIndex
CREATE INDEX "Account_type_idx" ON "Account"("type");

-- CreateIndex
CREATE INDEX "Account_isActive_idx" ON "Account"("isActive");

-- CreateIndex
CREATE INDEX "Account_customerId_idx" ON "Account"("customerId");

-- CreateIndex
CREATE INDEX "Account_companyId_idx" ON "Account"("companyId");

-- CreateIndex
CREATE INDEX "Account_groupId_idx" ON "Account"("groupId");

-- CreateIndex
CREATE INDEX "Customer_phone_idx" ON "Customer"("phone");

-- CreateIndex
CREATE INDEX "Customer_email_idx" ON "Customer"("email");

-- CreateIndex
CREATE INDEX "Company_phone_idx" ON "Company"("phone");

-- CreateIndex
CREATE INDEX "Company_email_idx" ON "Company"("email");

-- CreateIndex
CREATE INDEX "CustomerCompany_customerId_idx" ON "CustomerCompany"("customerId");

-- CreateIndex
CREATE INDEX "CustomerCompany_companyId_idx" ON "CustomerCompany"("companyId");

-- CreateIndex
CREATE INDEX "CrmLead_pipelineId_status_idx" ON "CrmLead"("pipelineId", "status");

-- CreateIndex
CREATE INDEX "CrmLead_ownerUserId_idx" ON "CrmLead"("ownerUserId");

-- CreateIndex
CREATE INDEX "CrmLead_createdAt_idx" ON "CrmLead"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_reference_key" ON "JournalEntry"("reference");

-- CreateIndex
CREATE INDEX "JournalEntry_status_date_idx" ON "JournalEntry"("status", "date");

-- CreateIndex
CREATE INDEX "JournalEntry_date_idx" ON "JournalEntry"("date");

-- CreateIndex
CREATE INDEX "JournalEntry_deletedAt_idx" ON "JournalEntry"("deletedAt");

-- CreateIndex
CREATE INDEX "JournalEntryAudit_originalId_idx" ON "JournalEntryAudit"("originalId");

-- CreateIndex
CREATE INDEX "JournalEntryAudit_actorId_idx" ON "JournalEntryAudit"("actorId");

-- CreateIndex
CREATE INDEX "JournalEntryAudit_createdAt_idx" ON "JournalEntryAudit"("createdAt");

-- CreateIndex
CREATE INDEX "JournalLine_accountId_idx" ON "JournalLine"("accountId");

-- CreateIndex
CREATE INDEX "JournalLine_accountId_journalEntryId_idx" ON "JournalLine"("accountId", "journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_shopOrderId_key" ON "Invoice"("shopOrderId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_accountId_idx" ON "Invoice"("accountId");

-- CreateIndex
CREATE INDEX "Invoice_shopOrderId_idx" ON "Invoice"("shopOrderId");

-- CreateIndex
CREATE INDEX "Invoice_issueDate_idx" ON "Invoice"("issueDate");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_journalEntryId_idx" ON "Payment"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatRoom_key_key" ON "ChatRoom"("key");

-- CreateIndex
CREATE INDEX "ChatRoom_type_idx" ON "ChatRoom"("type");

-- CreateIndex
CREATE INDEX "ChatRoom_ownerUserId_idx" ON "ChatRoom"("ownerUserId");

-- CreateIndex
CREATE INDEX "ChatRoom_roleId_idx" ON "ChatRoom"("roleId");

-- CreateIndex
CREATE INDEX "ChatRoomMember_userId_idx" ON "ChatRoomMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatRoomMember_roomId_userId_key" ON "ChatRoomMember"("roomId", "userId");

-- CreateIndex
CREATE INDEX "ChatMessage_roomId_createdAt_idx" ON "ChatMessage"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_senderUserId_idx" ON "ChatMessage"("senderUserId");

-- CreateIndex
CREATE UNIQUE INDEX "InvUnit_code_key" ON "InvUnit"("code");

-- CreateIndex
CREATE UNIQUE INDEX "InvCategory_slug_key" ON "InvCategory"("slug");

-- CreateIndex
CREATE INDEX "InvCategory_parentId_idx" ON "InvCategory"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "InvProductGroup_name_key" ON "InvProductGroup"("name");

-- CreateIndex
CREATE UNIQUE INDEX "InvBrand_name_key" ON "InvBrand"("name");

-- CreateIndex
CREATE UNIQUE INDEX "InvProduct_sku_key" ON "InvProduct"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "InvProduct_slug_key" ON "InvProduct"("slug");

-- CreateIndex
CREATE INDEX "InvProduct_unitId_idx" ON "InvProduct"("unitId");

-- CreateIndex
CREATE INDEX "InvProduct_categoryId_idx" ON "InvProduct"("categoryId");

-- CreateIndex
CREATE INDEX "InvProduct_groupId_idx" ON "InvProduct"("groupId");

-- CreateIndex
CREATE INDEX "InvProduct_brandId_idx" ON "InvProduct"("brandId");

-- CreateIndex
CREATE INDEX "InvProduct_warrantyTermId_idx" ON "InvProduct"("warrantyTermId");

-- CreateIndex
CREATE INDEX "InvProduct_isListedInShop_idx" ON "InvProduct"("isListedInShop");

-- CreateIndex
CREATE UNIQUE INDEX "InvVoucher_reference_key" ON "InvVoucher"("reference");

-- CreateIndex
CREATE INDEX "InvVoucher_type_status_idx" ON "InvVoucher"("type", "status");

-- CreateIndex
CREATE INDEX "InvVoucher_date_idx" ON "InvVoucher"("date");

-- CreateIndex
CREATE INDEX "InvVoucher_status_idx" ON "InvVoucher"("status");

-- CreateIndex
CREATE INDEX "InvVoucherLine_voucherId_idx" ON "InvVoucherLine"("voucherId");

-- CreateIndex
CREATE INDEX "InvVoucherLine_productId_idx" ON "InvVoucherLine"("productId");

-- CreateIndex
CREATE INDEX "InvStockLedger_productId_date_idx" ON "InvStockLedger"("productId", "date");

-- CreateIndex
CREATE INDEX "InvStockLedger_voucherId_idx" ON "InvStockLedger"("voucherId");

-- CreateIndex
CREATE UNIQUE INDEX "Pipeline_name_key" ON "Pipeline"("name");

-- CreateIndex
CREATE UNIQUE INDEX "SubStatusTransition_fromSubStatusId_toSubStatusId_key" ON "SubStatusTransition"("fromSubStatusId", "toSubStatusId");

-- CreateIndex
CREATE UNIQUE INDEX "StatusTransition_fromStatusId_toStatusId_key" ON "StatusTransition"("fromStatusId", "toStatusId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPortalCredential_customerId_key" ON "CustomerPortalCredential"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPortalCredential_phoneNormalized_key" ON "CustomerPortalCredential"("phoneNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPortalCredential_emailNormalized_key" ON "CustomerPortalCredential"("emailNormalized");

-- CreateIndex
CREATE INDEX "CustomerPortalCredential_customerId_idx" ON "CustomerPortalCredential"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPermission_userId_permissionId_key" ON "UserPermission"("userId", "permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopCoupon_code_key" ON "ShopCoupon"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ShopOrder_razorpayOrderId_key" ON "ShopOrder"("razorpayOrderId");

-- CreateIndex
CREATE INDEX "ShopOrder_accountId_idx" ON "ShopOrder"("accountId");

-- CreateIndex
CREATE INDEX "ShopOrder_customerId_idx" ON "ShopOrder"("customerId");

-- CreateIndex
CREATE INDEX "ShopOrder_status_idx" ON "ShopOrder"("status");

-- CreateIndex
CREATE INDEX "ShopOrder_pipelineId_idx" ON "ShopOrder"("pipelineId");

-- CreateIndex
CREATE INDEX "ShopOrder_statusId_idx" ON "ShopOrder"("statusId");

-- CreateIndex
CREATE INDEX "ShopOrder_sourceCouponId_idx" ON "ShopOrder"("sourceCouponId");

-- CreateIndex
CREATE INDEX "ShopOrderLine_orderId_idx" ON "ShopOrderLine"("orderId");

-- CreateIndex
CREATE INDEX "ShopOrderLine_productId_idx" ON "ShopOrderLine"("productId");

-- CreateIndex
CREATE INDEX "WallPost_wallUserId_idx" ON "WallPost"("wallUserId");

-- CreateIndex
CREATE INDEX "WallPost_authorId_idx" ON "WallPost"("authorId");

-- CreateIndex
CREATE INDEX "Device_accountId_idx" ON "Device"("accountId");

-- CreateIndex
CREATE INDEX "Ticket_status_idx" ON "Ticket"("status");

-- CreateIndex
CREATE INDEX "Ticket_pipelineId_status_idx" ON "Ticket"("pipelineId", "status");

-- CreateIndex
CREATE INDEX "Ticket_primaryOwnerId_idx" ON "Ticket"("primaryOwnerId");

-- CreateIndex
CREATE INDEX "Ticket_deviceId_idx" ON "Ticket"("deviceId");

-- CreateIndex
CREATE INDEX "Ticket_warrantyStatus_idx" ON "Ticket"("warrantyStatus");

-- CreateIndex
CREATE INDEX "Ticket_createdAt_idx" ON "Ticket"("createdAt");

-- CreateIndex
CREATE INDEX "Ticket_sourceShopOrderId_idx" ON "Ticket"("sourceShopOrderId");

-- CreateIndex
CREATE INDEX "TicketParticipant_ticketId_idx" ON "TicketParticipant"("ticketId");

-- CreateIndex
CREATE INDEX "TicketParticipant_userId_idx" ON "TicketParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketParticipant_ticketId_userId_addedBySubStatusId_key" ON "TicketParticipant"("ticketId", "userId", "addedBySubStatusId");

-- CreateIndex
CREATE INDEX "TicketLog_ticketId_idx" ON "TicketLog"("ticketId");

-- CreateIndex
CREATE INDEX "TicketLog_userId_idx" ON "TicketLog"("userId");

-- CreateIndex
CREATE INDEX "TicketPart_ticketId_idx" ON "TicketPart"("ticketId");

-- CreateIndex
CREATE INDEX "TicketPart_invProductId_idx" ON "TicketPart"("invProductId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "_BranchToUser_B_index" ON "_BranchToUser"("B");

-- CreateIndex
CREATE INDEX "_DepartmentToUser_B_index" ON "_DepartmentToUser"("B");

-- AddForeignKey
ALTER TABLE "AccountGroup" ADD CONSTRAINT "AccountGroup_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AccountGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AccountGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCompany" ADD CONSTRAINT "CustomerCompany_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCompany" ADD CONSTRAINT "CustomerCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_status_fkey" FOREIGN KEY ("status") REFERENCES "TicketStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntryAudit" ADD CONSTRAINT "JournalEntryAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_shopOrderId_fkey" FOREIGN KEY ("shopOrderId") REFERENCES "ShopOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRoom" ADD CONSTRAINT "ChatRoom_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRoom" ADD CONSTRAINT "ChatRoom_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRoomMember" ADD CONSTRAINT "ChatRoomMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "ChatRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRoomMember" ADD CONSTRAINT "ChatRoomMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "ChatRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvCategory" ADD CONSTRAINT "InvCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "InvCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvProduct" ADD CONSTRAINT "InvProduct_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "InvUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvProduct" ADD CONSTRAINT "InvProduct_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "InvCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvProduct" ADD CONSTRAINT "InvProduct_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "InvProductGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvProduct" ADD CONSTRAINT "InvProduct_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "InvBrand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvProduct" ADD CONSTRAINT "InvProduct_warrantyTermId_fkey" FOREIGN KEY ("warrantyTermId") REFERENCES "InvWarrantyTerm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvVoucher" ADD CONSTRAINT "InvVoucher_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvVoucherLine" ADD CONSTRAINT "InvVoucherLine_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "InvVoucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvVoucherLine" ADD CONSTRAINT "InvVoucherLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InvProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvStockLedger" ADD CONSTRAINT "InvStockLedger_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InvProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvStockLedger" ADD CONSTRAINT "InvStockLedger_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "InvVoucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_parentPostId_fkey" FOREIGN KEY ("parentPostId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_roleTemplateId_fkey" FOREIGN KEY ("roleTemplateId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPost" ADD CONSTRAINT "UserPost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPost" ADD CONSTRAINT "UserPost_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketStatus" ADD CONSTRAINT "TicketStatus_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketSubStatus" ADD CONSTRAINT "TicketSubStatus_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketSubStatus" ADD CONSTRAINT "TicketSubStatus_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "SubStatusGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubStatusTransition" ADD CONSTRAINT "SubStatusTransition_fromSubStatusId_fkey" FOREIGN KEY ("fromSubStatusId") REFERENCES "TicketSubStatus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubStatusTransition" ADD CONSTRAINT "SubStatusTransition_toSubStatusId_fkey" FOREIGN KEY ("toSubStatusId") REFERENCES "TicketSubStatus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusTransition" ADD CONSTRAINT "StatusTransition_fromStatusId_fkey" FOREIGN KEY ("fromStatusId") REFERENCES "TicketStatus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusTransition" ADD CONSTRAINT "StatusTransition_toStatusId_fkey" FOREIGN KEY ("toStatusId") REFERENCES "TicketStatus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPortalCredential" ADD CONSTRAINT "CustomerPortalCredential_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "TicketStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_sourceCouponId_fkey" FOREIGN KEY ("sourceCouponId") REFERENCES "ShopCoupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOrderLine" ADD CONSTRAINT "ShopOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOrderLine" ADD CONSTRAINT "ShopOrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InvProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WallPost" ADD CONSTRAINT "WallPost_wallUserId_fkey" FOREIGN KEY ("wallUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WallPost" ADD CONSTRAINT "WallPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_sourceShopOrderId_fkey" FOREIGN KEY ("sourceShopOrderId") REFERENCES "ShopOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_primaryOwnerId_fkey" FOREIGN KEY ("primaryOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_serviceCenterId_fkey" FOREIGN KEY ("serviceCenterId") REFERENCES "ServiceCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_status_fkey" FOREIGN KEY ("status") REFERENCES "TicketStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_subStatusId_fkey" FOREIGN KEY ("subStatusId") REFERENCES "TicketSubStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketParticipant" ADD CONSTRAINT "TicketParticipant_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketParticipant" ADD CONSTRAINT "TicketParticipant_addedBySubStatusId_fkey" FOREIGN KEY ("addedBySubStatusId") REFERENCES "TicketSubStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketParticipant" ADD CONSTRAINT "TicketParticipant_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketParticipant" ADD CONSTRAINT "TicketParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketLog" ADD CONSTRAINT "TicketLog_status_fkey" FOREIGN KEY ("status") REFERENCES "TicketStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketLog" ADD CONSTRAINT "TicketLog_subStatusId_fkey" FOREIGN KEY ("subStatusId") REFERENCES "TicketSubStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketLog" ADD CONSTRAINT "TicketLog_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketLog" ADD CONSTRAINT "TicketLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketPart" ADD CONSTRAINT "TicketPart_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketPart" ADD CONSTRAINT "TicketPart_invProductId_fkey" FOREIGN KEY ("invProductId") REFERENCES "InvProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_role_fkey" FOREIGN KEY ("role") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BranchToUser" ADD CONSTRAINT "_BranchToUser_A_fkey" FOREIGN KEY ("A") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BranchToUser" ADD CONSTRAINT "_BranchToUser_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DepartmentToUser" ADD CONSTRAINT "_DepartmentToUser_A_fkey" FOREIGN KEY ("A") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DepartmentToUser" ADD CONSTRAINT "_DepartmentToUser_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
