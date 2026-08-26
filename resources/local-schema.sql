-- GENERATED FILE — DO NOT EDIT BY HAND.
--
-- Regenerate with: pnpm db:local-schema
-- Verified by:     pnpm db:local-schema --check  (runs in pnpm precommit)
--
-- Creates the counter's local PostgreSQL replica from empty. Applied once, at first
-- run, by the desktop app. Source of truth is prisma/schema/ — edit that, then
-- regenerate this.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TierCurrentSaleScope" AS ENUM ('NONE', 'NEW', 'RETURNING', 'ALL');

-- CreateEnum
CREATE TYPE "ContactLifecycle" AS ENUM ('LEAD', 'PROSPECT', 'CUSTOMER', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CouponType" AS ENUM ('PERCENT', 'FLAT', 'FREE_ITEM', 'BOGO', 'SET_PRICE');

-- CreateEnum
CREATE TYPE "CouponStackScope" AS ENUM ('BILL', 'LINE');

-- CreateEnum
CREATE TYPE "CouponChannel" AS ENUM ('POS', 'SHOP', 'BOTH');

-- CreateEnum
CREATE TYPE "CouponApplyMode" AS ENUM ('CODE', 'AUTO');

-- CreateEnum
CREATE TYPE "CouponEligibility" AS ENUM ('ANY', 'NEW', 'RETURNING');

-- CreateEnum
CREATE TYPE "GiftCardStatus" AS ENUM ('DRAFT', 'ACTIVE', 'REDEEMED', 'EXPIRED', 'VOID');

-- CreateEnum
CREATE TYPE "GiftCardTxnType" AS ENUM ('ISSUE', 'REDEEM', 'REFUND', 'EXPIRE', 'ADJUST');

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
CREATE TYPE "CallDirection" AS ENUM ('INCOMING', 'OUTGOING', 'INTERNAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "GroupType" AS ENUM ('ASSET', 'LIABILITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "NormalBalance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "VoucherStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VoucherBinding" AS ENUM ('REGULAR', 'OPTIONAL');

-- CreateEnum
CREATE TYPE "EntryType" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "VoucherGlRole" AS ENUM ('BODY', 'TAX', 'TENDER', 'SHIPPING', 'DISCOUNT', 'ROUNDOFF', 'CHARGE');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'MOBILE_PAYMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "PosPayChannel" AS ENUM ('UPI', 'CARD', 'CHEQUE', 'WALLET', 'BANK_TRANSFER', 'GATEWAY');

-- CreateEnum
CREATE TYPE "VoucherType" AS ENUM ('CONTRA', 'PAYMENT', 'RECEIPT', 'CREDIT_NOTE', 'DEBIT_NOTE', 'JOURNAL');

-- CreateEnum
CREATE TYPE "AllocationMethod" AS ENUM ('NEW_REF', 'AGAINST_REF', 'ADVANCE', 'ON_ACCOUNT');

-- CreateEnum
CREATE TYPE "AllocationTargetType" AS ENUM ('INVOICE', 'VOUCHER', 'JOURNAL_ENTRY', 'UNIVERSAL_VOUCHER');

-- CreateEnum
CREATE TYPE "AllocationSourceType" AS ENUM ('VOUCHER', 'PAYMENT', 'INVOICE', 'JOURNAL_ENTRY');

-- CreateEnum
CREATE TYPE "InvVoucherType" AS ENUM ('PURCHASE', 'SALE', 'POS', 'ONLINE_INVOICE', 'ESTIMATE', 'POS_ESTIMATE', 'POS_ORDER', 'ONLINE_ORDER', 'SALE_RETURN', 'PURCHASE_RETURN', 'MANUFACTURING_JOURNAL', 'PHYSICAL_STOCK', 'BRANCH_TRANSFER', 'GRN', 'CHALLAN', 'REJECTION_IN', 'REJECTION_OUT', 'SALES_ORDER', 'PURCHASE_ORDER');

-- CreateEnum
CREATE TYPE "InvVoucherDeliveryMode" AS ENUM ('COUNTER', 'SHIPPED');

-- CreateEnum
CREATE TYPE "InvProductCodeKind" AS ENUM ('BARCODE', 'EAN', 'UPC');

-- CreateEnum
CREATE TYPE "GstRegType" AS ENUM ('REGULAR', 'COMPOSITION', 'SEZ', 'UNREGISTERED');

-- CreateEnum
CREATE TYPE "Taxability" AS ENUM ('TAXABLE', 'EXEMPT', 'NIL_RATED', 'NON_GST');

-- CreateEnum
CREATE TYPE "CostMethod" AS ENUM ('WEIGHTED_AVG', 'SIMPLE_AVG', 'FIFO', 'LAST_INWARD', 'MONTHLY_AVG');

-- CreateEnum
CREATE TYPE "StrategyPointDimension" AS ENUM ('BASE', 'BRAND', 'CATEGORY', 'GROUP', 'PRODUCT', 'STOCK_BAND', 'AGE_BAND', 'MOVE_BAND');

-- CreateEnum
CREATE TYPE "EffectiveSalePriceSource" AS ENUM ('STRATEGY', 'COMPUTED', 'SAVED');

-- CreateEnum
CREATE TYPE "AdditionalCostAllocationKind" AS ENUM ('ALLOCATION', 'DISMISSAL');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('ONLINE', 'IN_STORE', 'PHONE', 'WHATSAPP', 'OTHER');

-- CreateEnum
CREATE TYPE "VoucherLinkKind" AS ENUM ('TICKET', 'DEAL', 'SHOP_ORDER', 'ORDER_PIPELINE', 'ORDER_STATUS');

-- CreateEnum
CREATE TYPE "ChatRoomType" AS ENUM ('SYSTEM_INBOX', 'PERSONAL_INBOX', 'ORG_GROUP', 'DIRECT_MESSAGE');

-- CreateEnum
CREATE TYPE "ChatMessageType" AS ENUM ('SYSTEM', 'USER');

-- CreateEnum
CREATE TYPE "LoyaltyReason" AS ENUM ('EARN_SALE', 'REDEEM_SALE', 'REVERSAL_RETURN', 'ADMIN_ADJUST', 'MILESTONE_BONUS');

-- CreateEnum
CREATE TYPE "LoyaltyRuleScope" AS ENUM ('CATEGORY', 'GROUP', 'PRODUCT');

-- CreateEnum
CREATE TYPE "PosShiftStatus" AS ENUM ('OPEN', 'AWAITING_HANDOVER', 'CLOSED');

-- CreateEnum
CREATE TYPE "PosHandoverStatus" AS ENUM ('PENDING', 'ACCEPTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShopOrderStatus" AS ENUM ('DRAFT', 'PENDING_PAYMENT', 'PAID', 'PACKED', 'SHIPPED', 'DELIVERED', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShopPaymentMethod" AS ENUM ('COD', 'ONLINE');

-- CreateEnum
CREATE TYPE "ShopOutOfStockPolicy" AS ENUM ('HIDE', 'NOTIFY', 'BACKORDER');

-- CreateEnum
CREATE TYPE "SocialActorKind" AS ENUM ('USER', 'PERSON');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('PENDING', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "HelpOutcome" AS ENUM ('NOT_FEASIBLE', 'CUSTOMER_DECLINED', 'RESOLVED_INFO', 'CONVERTED_TO_SERVICE', 'CONVERTED_TO_SALE');

-- CreateEnum
CREATE TYPE "TicketLogKind" AS ENUM ('NOTE', 'COMMENT', 'CALL', 'MEETING', 'TASK', 'SYSTEM');

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
    "normalBalance" "NormalBalance",
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "parentId" INTEGER,
    "groupId" INTEGER,
    "personId" INTEGER,
    "companyId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creditLimit" DECIMAL(14,2),
    "bankJson" JSONB,
    "loanJson" JSONB,
    "creditCardJson" JSONB,
    "bnplJson" JSONB,
    "walletJson" JSONB,
    "gatewayJson" JSONB,
    "openingBalance" DECIMAL(14,2),
    "openingBalanceType" "EntryType",
    "openingBalanceDate" DATE,
    "reconciledThrough" DATE,
    "reconciledAt" TIMESTAMP(3),
    "reconciledById" INTEGER,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountAlias" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "alias" VARCHAR(200) NOT NULL,
    "aliasKey" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BiGstPlanningMonth" (
    "yearMonth" TEXT NOT NULL,
    "purchaseOverride" DECIMAL(14,2),
    "saleOverride" DECIMAL(14,2),
    "depositOverride" DECIMAL(14,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BiGstPlanningMonth_pkey" PRIMARY KEY ("yearMonth")
);

-- CreateTable
CREATE TABLE "BiGstPlanningFy" (
    "fyStartYear" INTEGER NOT NULL,
    "allowedDiff" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BiGstPlanningFy_pkey" PRIMARY KEY ("fyStartYear")
);

-- CreateTable
CREATE TABLE "BiGstPlanningConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "taxRatePercent" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "depositGapPercent" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "presumptiveRatePercent" DECIMAL(5,2) NOT NULL DEFAULT 8,
    "incomeTaxFreeLimit" DECIMAL(14,2) NOT NULL DEFAULT 1200000,
    "bankAccountIds" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BiGstPlanningConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditLimitConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "autoEnabled" BOOLEAN NOT NULL DEFAULT false,
    "windowDays" INTEGER NOT NULL DEFAULT 90,
    "pctOfSales" DECIMAL(6,2) NOT NULL DEFAULT 10,
    "maxAutoLimit" DECIMAL(14,2),
    "roundToStep" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditLimitConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerTierPeriod" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "currentSaleScope" "TierCurrentSaleScope" NOT NULL DEFAULT 'NONE',
    "currentSaleOnly" BOOLEAN NOT NULL DEFAULT false,
    "fromDay" INTEGER NOT NULL DEFAULT 0,
    "toDay" INTEGER NOT NULL DEFAULT 180,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerTierPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerTier" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "minSpend" DECIMAL(14,2) NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "periodId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "agreedToTerms" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "agreedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lifecycleStage" "ContactLifecycle" NOT NULL DEFAULT 'LEAD',
    "ownerPositionId" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "noDiscount" BOOLEAN NOT NULL DEFAULT false,
    "qualityLog" JSONB NOT NULL DEFAULT '[]',
    "customerGroupId" INTEGER,
    "gstin" TEXT,
    "gstStateCode" TEXT,
    "gstRegType" "GstRegType",
    "shippingStateCode" TEXT,
    "convertedToCompanyId" INTEGER,
    "convertedAt" TIMESTAMP(3),
    "mergedIntoPersonId" INTEGER,
    "mergedAt" TIMESTAMP(3),

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "companyReg" TEXT,
    "taxId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lifecycleStage" "ContactLifecycle" NOT NULL DEFAULT 'LEAD',
    "ownerPositionId" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "noDiscount" BOOLEAN NOT NULL DEFAULT false,
    "qualityLog" JSONB NOT NULL DEFAULT '[]',
    "customerGroupId" INTEGER,
    "gstin" TEXT,
    "gstStateCode" TEXT,
    "gstRegType" "GstRegType",
    "shippingStateCode" TEXT,
    "financialYearFrom" DATE,
    "booksBeginningFrom" DATE,
    "convertedToPersonId" INTEGER,
    "convertedAt" TIMESTAMP(3),
    "mergedIntoCompanyId" INTEGER,
    "mergedAt" TIMESTAMP(3),

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerGroup" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonCompany" (
    "id" SERIAL NOT NULL,
    "personId" INTEGER NOT NULL,
    "companyId" INTEGER NOT NULL,
    "role" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlinkedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Phone" (
    "id" SERIAL NOT NULL,
    "phone" TEXT NOT NULL,
    "personId" INTEGER,
    "companyId" INTEGER,
    "label" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Phone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Email" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "personId" INTEGER,
    "companyId" INTEGER,
    "label" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Email_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Call" (
    "id" SERIAL NOT NULL,
    "direction" "CallDirection" NOT NULL,
    "phone" TEXT,
    "rawNumber" TEXT,
    "fromExt" TEXT,
    "toExt" TEXT,
    "trunk" TEXT,
    "serial" TEXT,
    "status" TEXT,
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "speechSec" INTEGER NOT NULL DEFAULT 0,
    "answerSec" INTEGER NOT NULL DEFAULT 0,
    "holdSec" INTEGER NOT NULL DEFAULT 0,
    "amount" DECIMAL(10,2),
    "units" INTEGER,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "raw" TEXT,
    "sourceHost" TEXT,
    "alsoPushedBy" JSONB,
    "note" TEXT,
    "spam" BOOLEAN NOT NULL DEFAULT false,
    "ticketId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" SERIAL NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "CouponType" NOT NULL,
    "channels" "CouponChannel" NOT NULL DEFAULT 'BOTH',
    "applyMode" "CouponApplyMode" NOT NULL DEFAULT 'CODE',
    "percentOff" DECIMAL(5,2),
    "maxDiscountAmt" DECIMAL(14,2),
    "flatAmt" DECIMAL(14,2),
    "freeProductId" INTEGER,
    "freeQty" DECIMAL(10,3),
    "freeDiscountPct" DECIMAL(5,2),
    "buyProductId" INTEGER,
    "buyQty" DECIMAL(10,3),
    "getQty" DECIMAL(10,3),
    "setPriceAmt" DECIMAL(14,2),
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "minBillValue" DECIMAL(14,2),
    "totalUsageLimit" INTEGER,
    "perCustomerLimit" INTEGER,
    "singleUse" BOOLEAN NOT NULL DEFAULT false,
    "eligibility" "CouponEligibility" NOT NULL DEFAULT 'ANY',
    "stackable" BOOLEAN NOT NULL DEFAULT false,
    "stackScope" "CouponStackScope" NOT NULL DEFAULT 'BILL',
    "independent" BOOLEAN NOT NULL DEFAULT false,
    "ownerAccountId" INTEGER,
    "issuedByMilestoneId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponProductRule" (
    "id" SERIAL NOT NULL,
    "couponId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "productId" INTEGER,
    "categoryId" INTEGER,
    "groupId" INTEGER,
    "brandId" INTEGER,

    CONSTRAINT "CouponProductRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponRedemption" (
    "id" SERIAL NOT NULL,
    "couponId" INTEGER NOT NULL,
    "accountId" INTEGER,
    "universalVoucherId" INTEGER,
    "amount" DECIMAL(14,2) NOT NULL,
    "channel" "CouponChannel" NOT NULL,
    "reversedAt" TIMESTAMP(3),
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouponRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftCard" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "initialValue" DECIMAL(14,2) NOT NULL,
    "balance" DECIMAL(14,2) NOT NULL,
    "status" "GiftCardStatus" NOT NULL DEFAULT 'DRAFT',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "ownerAccountId" INTEGER,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftCardTxn" (
    "id" SERIAL NOT NULL,
    "giftCardId" INTEGER NOT NULL,
    "type" "GiftCardTxnType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "universalVoucherId" INTEGER,
    "balanceAfter" DECIMAL(14,2) NOT NULL,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftCardTxn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "maxTotalDiscountPct" DECIMAL(5,2),
    "couponExpenseAccountId" INTEGER,
    "giftCardLiabilityAccountId" INTEGER,
    "giftCardBreakageAccountId" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CouponConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "entityType" TEXT NOT NULL,
    "subtype" TEXT,
    "originalId" INTEGER NOT NULL,
    "originalRef" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "snapshot" JSONB NOT NULL,
    "actorId" INTEGER NOT NULL,
    "restoredAt" TIMESTAMP(3),
    "restoredById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UniversalVoucher" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "voucherNo" TEXT,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "narration" TEXT,
    "denomJson" JSONB,
    "status" "VoucherStatus" NOT NULL DEFAULT 'DRAFT',
    "binding" "VoucherBinding" NOT NULL DEFAULT 'REGULAR',
    "branchId" TEXT,
    "partyAccountId" INTEGER,
    "postedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" INTEGER,
    "cancelReason" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedById" INTEGER,
    "deleteReason" TEXT,
    "createdById" INTEGER NOT NULL,
    "sourceCreatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UniversalVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherGlLine" (
    "id" SERIAL NOT NULL,
    "universalVoucherId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "type" "EntryType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT,
    "branchId" TEXT,
    "role" "VoucherGlRole",
    "seq" INTEGER,
    "method" "PaymentMethod",
    "reference" TEXT,
    "sourceJournalLineId" INTEGER,

    CONSTRAINT "VoucherGlLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherLink" (
    "id" SERIAL NOT NULL,
    "universalVoucherId" INTEGER NOT NULL,
    "kind" "VoucherLinkKind" NOT NULL,
    "targetId" TEXT NOT NULL,

    CONSTRAINT "VoucherLink_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "BooksConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "restartMonth" INTEGER NOT NULL DEFAULT 4,
    "restartDay" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BooksConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherSeries" (
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fyStartYear" INTEGER,
    "typeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "typeValue" TEXT NOT NULL DEFAULT '',
    "userEnabled" BOOLEAN NOT NULL DEFAULT false,
    "userMaxWidth" INTEGER NOT NULL DEFAULT 3,
    "yearEnabled" BOOLEAN NOT NULL DEFAULT true,
    "yearFormat" TEXT NOT NULL DEFAULT 'FY_SHORT',
    "startFrom" INTEGER NOT NULL DEFAULT 1,
    "padWidth" INTEGER NOT NULL DEFAULT 4,
    "nextSeq" INTEGER NOT NULL DEFAULT 0,
    "partOrder" TEXT NOT NULL DEFAULT 'type,-,year,-,number',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoucherSeries_pkey" PRIMARY KEY ("kind")
);

-- CreateTable
CREATE TABLE "VoucherPrintTemplate" (
    "kind" TEXT NOT NULL,
    "headerLine1" TEXT NOT NULL DEFAULT '',
    "headerLine2" TEXT NOT NULL DEFAULT '',
    "addressBlock" TEXT NOT NULL DEFAULT '',
    "gstinLine" TEXT NOT NULL DEFAULT '',
    "phoneLine" TEXT NOT NULL DEFAULT '',
    "logoUrl" TEXT NOT NULL DEFAULT '',
    "showLogo" BOOLEAN NOT NULL DEFAULT false,
    "showLogoThermal" BOOLEAN NOT NULL DEFAULT false,
    "showHeaderText" BOOLEAN NOT NULL DEFAULT true,
    "showHeaderTextThermal" BOOLEAN NOT NULL DEFAULT true,
    "showAddress" BOOLEAN NOT NULL DEFAULT true,
    "showAddressThermal" BOOLEAN NOT NULL DEFAULT true,
    "showBranchAddress" BOOLEAN NOT NULL DEFAULT false,
    "showBranchAddressThermal" BOOLEAN NOT NULL DEFAULT false,
    "showGstin" BOOLEAN NOT NULL DEFAULT true,
    "showGstinThermal" BOOLEAN NOT NULL DEFAULT true,
    "showPhone" BOOLEAN NOT NULL DEFAULT true,
    "showPhoneThermal" BOOLEAN NOT NULL DEFAULT true,
    "showTaxSummary" BOOLEAN NOT NULL DEFAULT true,
    "showTaxSummaryThermal" BOOLEAN NOT NULL DEFAULT true,
    "showMrp" BOOLEAN NOT NULL DEFAULT true,
    "showMrpThermal" BOOLEAN NOT NULL DEFAULT true,
    "showSignature" BOOLEAN NOT NULL DEFAULT false,
    "showSignatureThermal" BOOLEAN NOT NULL DEFAULT false,
    "showQrCode" BOOLEAN NOT NULL DEFAULT false,
    "showBarcode" BOOLEAN NOT NULL DEFAULT false,
    "showBarcodeThermal" BOOLEAN NOT NULL DEFAULT false,
    "showBank" BOOLEAN NOT NULL DEFAULT false,
    "showBankThermal" BOOLEAN NOT NULL DEFAULT false,
    "showPartyBalance" BOOLEAN NOT NULL DEFAULT false,
    "showPartyBalanceThermal" BOOLEAN NOT NULL DEFAULT false,
    "showTicket" BOOLEAN NOT NULL DEFAULT true,
    "showTicketThermal" BOOLEAN NOT NULL DEFAULT true,
    "showTicketTl" BOOLEAN NOT NULL DEFAULT true,
    "showDate" BOOLEAN NOT NULL DEFAULT true,
    "showDateThermal" BOOLEAN NOT NULL DEFAULT true,
    "showDateTl" BOOLEAN NOT NULL DEFAULT true,
    "showRef" BOOLEAN NOT NULL DEFAULT true,
    "showRefThermal" BOOLEAN NOT NULL DEFAULT true,
    "showRefTl" BOOLEAN NOT NULL DEFAULT true,
    "showDevice" BOOLEAN NOT NULL DEFAULT false,
    "showDeviceThermal" BOOLEAN NOT NULL DEFAULT false,
    "showDeviceTl" BOOLEAN NOT NULL DEFAULT false,
    "showFooter" BOOLEAN NOT NULL DEFAULT true,
    "showFooterThermal" BOOLEAN NOT NULL DEFAULT true,
    "showFooterTl" BOOLEAN NOT NULL DEFAULT true,
    "showSentBy" BOOLEAN NOT NULL DEFAULT true,
    "showSentByThermal" BOOLEAN NOT NULL DEFAULT true,
    "showReceivedBy" BOOLEAN NOT NULL DEFAULT true,
    "showReceivedByThermal" BOOLEAN NOT NULL DEFAULT true,
    "showPreparedBy" BOOLEAN NOT NULL DEFAULT true,
    "showPreparedByThermal" BOOLEAN NOT NULL DEFAULT true,
    "showFindings" BOOLEAN NOT NULL DEFAULT true,
    "showFindingsThermal" BOOLEAN NOT NULL DEFAULT true,
    "termsText" TEXT NOT NULL DEFAULT '',
    "footerLine" TEXT NOT NULL DEFAULT 'Thank you · Visit again',
    "signatureLabel" TEXT NOT NULL DEFAULT 'Authorised Signatory',
    "disclaimerLine" TEXT NOT NULL DEFAULT 'This is a computer-generated document and does not require a signature.',
    "defaultPaper" TEXT NOT NULL DEFAULT 'A4',
    "paperWidthMm" INTEGER NOT NULL DEFAULT 80,
    "fontFamily" TEXT NOT NULL DEFAULT 'Courier New, monospace',
    "fontSizePx" INTEGER NOT NULL DEFAULT 12,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" INTEGER,

    CONSTRAINT "VoucherPrintTemplate_pkey" PRIMARY KEY ("kind")
);

-- CreateTable
CREATE TABLE "ChatRoom" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" "ChatRoomType" NOT NULL,
    "name" TEXT NOT NULL,
    "ownerUserId" INTEGER,
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
    "baseUnitId" INTEGER,
    "conversionFactor" INTEGER,

    CONSTRAINT "InvUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstRate" (
    "id" SERIAL NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "GstRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvCategory" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "imageUrl" TEXT,
    "description" TEXT,
    "parentId" INTEGER,
    "slowAfterDays" INTEGER,
    "nonMovingAfterDays" INTEGER,
    "deadAfterDays" INTEGER,
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
    "slug" TEXT,
    "imageUrl" TEXT,
    "description" TEXT,
    "parentId" INTEGER,
    "gstRateId" INTEGER,
    "hsnCode" TEXT,
    "taxability" "Taxability",
    "slowAfterDays" INTEGER,
    "nonMovingAfterDays" INTEGER,
    "deadAfterDays" INTEGER,

    CONSTRAINT "InvProductGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvBrand" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "slug" TEXT,
    "imageUrl" TEXT,
    "description" TEXT,

    CONSTRAINT "InvBrand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvWarrantyTerm" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "durationDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvWarrantyTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvAttributeMaster" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvAttributeMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvNamingConfig" (
    "id" SERIAL NOT NULL,
    "nameFields" JSONB NOT NULL DEFAULT '[]',
    "separator" TEXT NOT NULL DEFAULT ' ',
    "onlineNameFields" JSONB NOT NULL DEFAULT '[]',
    "onlineSeparator" TEXT NOT NULL DEFAULT ' ',
    "slugFields" JSONB NOT NULL DEFAULT '[]',
    "fallbackFields" JSONB NOT NULL DEFAULT '{}',
    "slugEnabled" BOOLEAN NOT NULL DEFAULT true,
    "slugSeparator" TEXT NOT NULL DEFAULT '-',
    "slugMaxLength" INTEGER NOT NULL DEFAULT 80,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvNamingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvProduct" (
    "id" SERIAL NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "namePart" TEXT,
    "unitId" INTEGER NOT NULL,
    "categoryId" INTEGER,
    "groupId" INTEGER,
    "brandId" INTEGER,
    "warrantyTermId" INTEGER,
    "modelNo" TEXT,
    "notes" TEXT,
    "requireSaleNote" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "slug" TEXT,
    "shopSubheading" TEXT,
    "shopDescription" TEXT,
    "shopCategory" TEXT,
    "effectiveSalePricePaise" INTEGER,
    "mrpPaise" INTEGER,
    "shopBadge" TEXT,
    "imageUrl" TEXT,
    "galleryJson" JSONB,
    "specsJson" JSONB,
    "attrsJson" JSONB,
    "stock" INTEGER,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 5,
    "leadTimeDays" INTEGER,
    "orderPackQty" INTEGER,
    "minOrderQty" INTEGER,
    "isListedInShop" BOOLEAN NOT NULL DEFAULT false,
    "allowBackorder" BOOLEAN NOT NULL DEFAULT false,
    "weightGrams" INTEGER,
    "lengthCm" INTEGER,
    "breadthCm" INTEGER,
    "heightCm" INTEGER,
    "costMethod" "CostMethod",
    "marginPercent" DECIMAL(6,2),
    "priceOverridden" BOOLEAN NOT NULL DEFAULT false,
    "effectiveSalePriceSource" "EffectiveSalePriceSource" NOT NULL DEFAULT 'STRATEGY',
    "savedSalePricePaise" INTEGER,
    "salePriceFrozenAt" TIMESTAMP(3),
    "savedProfitPaise" INTEGER,
    "openingStock" DECIMAL(10,3),
    "openingRate" DECIMAL(14,2),
    "openingValue" DECIMAL(14,2),
    "openingStockDate" DATE,
    "hsnCode" TEXT,
    "gstRateId" INTEGER,
    "taxability" "Taxability",

    CONSTRAINT "InvProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_protection" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_protection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inv_product_codes" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "kind" "InvProductCodeKind" NOT NULL,
    "value" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inv_product_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inv_product_branches" (
    "productId" INTEGER NOT NULL,
    "branchId" TEXT NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inv_product_branches_pkey" PRIMARY KEY ("productId","branchId")
);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" SERIAL NOT NULL,
    "orderSource" TEXT NOT NULL,
    "orderId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'HELD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redemption_holds" (
    "id" SERIAL NOT NULL,
    "orderSource" TEXT NOT NULL,
    "orderId" INTEGER NOT NULL,
    "rewardType" TEXT NOT NULL,
    "rewardRef" TEXT,
    "rewardId" INTEGER,
    "accountId" INTEGER,
    "points" INTEGER,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "meta" JSONB,
    "status" TEXT NOT NULL DEFAULT 'HELD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "redemption_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherDetail" (
    "id" SERIAL NOT NULL,
    "partyJson" JSONB,
    "partyType" TEXT,
    "partyId" INTEGER,
    "refNumber" TEXT,
    "refDate" DATE,
    "refVoucherId" INTEGER,
    "creditPeriodDays" INTEGER,
    "placeOfSupply" TEXT,
    "deliveryMode" "InvVoucherDeliveryMode" NOT NULL DEFAULT 'COUNTER',
    "discountPct" DECIMAL(5,2),
    "discountAmt" DECIMAL(14,2),
    "shippingAmt" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "shippingTaxAmt" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "roundOff" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "universalVoucherId" INTEGER,
    "showPrices" BOOLEAN NOT NULL DEFAULT true,
    "bomId" INTEGER,
    "destinationBranchId" TEXT,
    "settlementJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoucherDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherInventoryLine" (
    "id" SERIAL NOT NULL,
    "universalVoucherId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "description" TEXT,
    "direction" TEXT,
    "quantity" DECIMAL(10,3) NOT NULL,
    "freeQty" DECIMAL(10,3),
    "rate" DECIMAL(14,2) NOT NULL,
    "mrpPaise" INTEGER,
    "savedSalePricePaise" INTEGER,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountAmt" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "VoucherInventoryLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvStockLedger" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "universalVoucherId" INTEGER NOT NULL,
    "branchId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "inQty" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "outQty" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "rate" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "InvStockLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvBom" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "outputProductId" INTEGER NOT NULL,
    "outputQty" DECIMAL(10,3) NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvBom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvBomLine" (
    "id" SERIAL NOT NULL,
    "bomId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "qty" DECIMAL(10,3) NOT NULL,

    CONSTRAINT "InvBomLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_points" (
    "id" SERIAL NOT NULL,
    "dimension" "StrategyPointDimension" NOT NULL,
    "refKey" TEXT NOT NULL DEFAULT '',
    "points" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "strategy_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "additional_cost_allocations" (
    "id" SERIAL NOT NULL,
    "kind" "AdditionalCostAllocationKind" NOT NULL,
    "sourceVoucherGlLineId" INTEGER,
    "amountPaise" INTEGER NOT NULL,
    "productId" INTEGER,
    "perUnitPaise" INTEGER,
    "quantity" DECIMAL(14,3),
    "sourceUniversalVoucherId" INTEGER,
    "note" TEXT,
    "date" DATE NOT NULL,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "additional_cost_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "earnEnabled" BOOLEAN NOT NULL DEFAULT true,
    "redeemEnabled" BOOLEAN NOT NULL DEFAULT true,
    "globalEarnRatePer" DECIMAL(14,2) NOT NULL DEFAULT 100,
    "redeemValue" DECIMAL(14,2) NOT NULL DEFAULT 1,
    "expiryEnabled" BOOLEAN NOT NULL DEFAULT true,
    "expiryDays" INTEGER NOT NULL DEFAULT 365,
    "minEarnInvoiceValue" DECIMAL(14,2),
    "minRedeemInvoiceValue" DECIMAL(14,2),
    "minRedeemPoints" INTEGER,
    "maxRedeemPctOfBill" DECIMAL(5,2),
    "redeemExpenseAccountId" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyEarnRule" (
    "id" SERIAL NOT NULL,
    "scope" "LoyaltyRuleScope" NOT NULL,
    "categoryId" INTEGER,
    "groupId" INTEGER,
    "productId" INTEGER,
    "multiplier" DECIMAL(6,3) NOT NULL DEFAULT 1.0,
    "redeemCapPct" DECIMAL(5,2),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyEarnRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyMilestone" (
    "id" SERIAL NOT NULL,
    "threshold" DECIMAL(14,2) NOT NULL,
    "bonusPoints" INTEGER NOT NULL,
    "label" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "issuesCouponTemplateId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyMilestoneAward" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "milestoneId" INTEGER NOT NULL,
    "universalVoucherId" INTEGER,
    "pointsGranted" INTEGER NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyMilestoneAward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyAccount" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "totalEarned" INTEGER NOT NULL DEFAULT 0,
    "totalRedeemed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyLot" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "universalVoucherId" INTEGER,
    "pointsEarned" INTEGER NOT NULL,
    "pointsRemaining" INTEGER NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyLedger" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "universalVoucherId" INTEGER,
    "delta" INTEGER NOT NULL,
    "reason" "LoyaltyReason" NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "note" TEXT,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pinCode" TEXT,
    "country" TEXT DEFAULT 'India',
    "email" TEXT,
    "gstin" TEXT,
    "gstStateCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vaultAccountId" INTEGER,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "branchId" TEXT,
    "isAllAccess" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "branchId" TEXT,
    "departmentId" TEXT,
    "parentPositionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPosition" (
    "userId" INTEGER NOT NULL,
    "positionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPosition_pkey" PRIMARY KEY ("userId","positionId")
);

-- CreateTable
CREATE TABLE "PositionRole" (
    "positionId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "PositionRole_pkey" PRIMARY KEY ("positionId","roleId")
);

-- CreateTable
CREATE TABLE "OrgDefaults" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "defaultUnitId" INTEGER,
    "defaultGstRateId" INTEGER,
    "defaultHsnCode" TEXT,
    "defaultTaxability" "Taxability",
    "valuationMethod" "CostMethod" NOT NULL DEFAULT 'WEIGHTED_AVG',
    "defaultSaleCreditPeriod" INTEGER,
    "defaultPurchaseCreditPeriod" INTEGER,
    "defaultLeadTimeDays" INTEGER NOT NULL DEFAULT 7,
    "reorderSlowAfterDays" INTEGER NOT NULL DEFAULT 30,
    "reorderNonMovingAfterDays" INTEGER NOT NULL DEFAULT 90,
    "reorderDeadAfterDays" INTEGER NOT NULL DEFAULT 180,
    "reorderNewItemDays" INTEGER NOT NULL DEFAULT 60,
    "clearanceMarginCutoffPct" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "defaultCurrencySymbol" TEXT NOT NULL DEFAULT '₹',
    "barcodeBandsJson" JSONB NOT NULL DEFAULT '[]',
    "cashDenominationsJson" JSONB NOT NULL DEFAULT '[2000, 500, 200, 100, 50, 20, 10, 5, 2, 1]',
    "shippingPoolGroupId" INTEGER,
    "shopPublishRulesJson" JSONB,
    "shopOutOfStockPolicy" "ShopOutOfStockPolicy" NOT NULL DEFAULT 'NOTIFY',
    "posEstimateShowDiscountsJson" JSONB,
    "storefrontHomeJson" JSONB,
    "labelTemplateJson" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgDefaults_pkey" PRIMARY KEY ("id")
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
    "entityType" TEXT NOT NULL DEFAULT 'repair',
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
    "actionLabel" TEXT,
    "warrantyScope" TEXT NOT NULL DEFAULT 'any',
    "leavePrompt" TEXT,
    "announceOnEntry" BOOLEAN NOT NULL DEFAULT false,
    "etaText" TEXT,
    "resolveTimeHours" INTEGER,
    "resolveGroupId" TEXT,
    "workId" TEXT,
    "startWorkerId" TEXT,
    "pipelineId" TEXT,

    CONSTRAINT "TicketStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketWorker" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "publicLabel" TEXT,
    "color" TEXT NOT NULL DEFAULT 'bg-gray-100 text-gray-600',
    "order" INTEGER NOT NULL,
    "statusId" TEXT,
    "triggerMap" JSONB NOT NULL DEFAULT '{}',
    "actionLabel" TEXT,
    "autoRevertOnClear" BOOLEAN NOT NULL DEFAULT true,
    "transitionNote" TEXT,
    "skipNoteOnEntry" BOOLEAN NOT NULL DEFAULT false,
    "requireNoteOnEntry" BOOLEAN NOT NULL DEFAULT false,
    "entryQuestion" TEXT,
    "entryArgs" JSONB NOT NULL DEFAULT '[]',
    "warrantyScope" TEXT NOT NULL DEFAULT 'any',
    "successWorkerId" TEXT,
    "failWorkerId" TEXT,
    "successStatusId" TEXT,
    "failStatusId" TEXT,
    "retrySchedule" JSONB NOT NULL DEFAULT '[]',
    "spawnPipelineId" TEXT,
    "parentSignal" TEXT,
    "actions" JSONB NOT NULL DEFAULT '[]',
    "workId" TEXT,
    "pipelineId" TEXT,

    CONSTRAINT "TicketWorker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'bg-gray-100 text-gray-600',
    "order" INTEGER NOT NULL DEFAULT 0,
    "permissionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkGroupWork" (
    "workGroupId" TEXT NOT NULL,
    "workId" TEXT NOT NULL,

    CONSTRAINT "WorkGroupWork_pkey" PRIMARY KEY ("workGroupId","workId")
);

-- CreateTable
CREATE TABLE "Work" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'bg-gray-100 text-gray-600',
    "order" INTEGER NOT NULL DEFAULT 0,
    "successLabel" TEXT,
    "failLabel" TEXT,
    "prompt" TEXT,
    "startLabel" TEXT,
    "successPopup" BOOLEAN NOT NULL DEFAULT false,
    "failPopup" BOOLEAN NOT NULL DEFAULT false,
    "kind" TEXT NOT NULL DEFAULT 'human',
    "toolType" TEXT,
    "toolConfig" JSONB NOT NULL DEFAULT '{}',
    "args" JSONB NOT NULL DEFAULT '[]',
    "permissionId" TEXT,

    CONSTRAINT "Work_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerTransition" (
    "id" SERIAL NOT NULL,
    "fromWorkerId" TEXT,
    "toWorkerId" TEXT NOT NULL,

    CONSTRAINT "WorkerTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusTransition" (
    "id" SERIAL NOT NULL,
    "fromStatusId" TEXT NOT NULL,
    "toStatusId" TEXT NOT NULL,

    CONSTRAINT "StatusTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonPortalCredential" (
    "id" SERIAL NOT NULL,
    "personId" INTEGER NOT NULL,
    "phoneNormalized" TEXT,
    "emailNormalized" TEXT,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonPortalCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_counters" (
    "id" SERIAL NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tillAccountId" INTEGER NOT NULL,
    "allowedExpenseAccountIds" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "epbxExtension" TEXT,
    "boundDeviceId" TEXT,
    "boundDeviceLabel" TEXT,
    "boundAt" TIMESTAMP(3),

    CONSTRAINT "pos_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_counter_payment_accounts" (
    "id" SERIAL NOT NULL,
    "counterId" INTEGER NOT NULL,
    "channel" "PosPayChannel" NOT NULL,
    "label" TEXT NOT NULL,
    "accountId" INTEGER NOT NULL,
    "vpa" TEXT,
    "configJson" JSONB NOT NULL DEFAULT '{}',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "defaultVisible" BOOLEAN NOT NULL DEFAULT false,
    "gatewayId" INTEGER,

    CONSTRAINT "pos_counter_payment_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_gateways" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'TEST',
    "enabledForCounter" BOOLEAN NOT NULL DEFAULT true,
    "enabledForOnline" BOOLEAN NOT NULL DEFAULT false,
    "configJson" JSONB NOT NULL DEFAULT '{}',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_gateways_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_services" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "accountId" INTEGER NOT NULL,
    "gstRateId" INTEGER,
    "defaultPricePaise" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_shifts" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "counterId" INTEGER NOT NULL,
    "branchId" TEXT NOT NULL,
    "status" "PosShiftStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedById" INTEGER NOT NULL,
    "openingFloatPaise" BIGINT NOT NULL DEFAULT 0,
    "carryOverFloatPaise" BIGINT NOT NULL DEFAULT 0,
    "vaultTopUpPaise" BIGINT NOT NULL DEFAULT 0,
    "openingContraVoucherId" INTEGER,
    "closedAt" TIMESTAMP(3),
    "closedById" INTEGER,
    "declaredCashPaise" BIGINT,
    "expectedCashPaise" BIGINT,
    "variancePaise" BIGINT,
    "carryOverNextPaise" BIGINT,
    "toVaultPaise" BIGINT,
    "closingContraVoucherId" INTEGER,
    "varianceJournalEntryId" INTEGER,
    "handoverToShiftId" INTEGER,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_cash_drops" (
    "id" SERIAL NOT NULL,
    "shiftId" INTEGER NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "droppedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "droppedById" INTEGER NOT NULL,
    "notes" TEXT,

    CONSTRAINT "pos_cash_drops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_expenditures" (
    "id" SERIAL NOT NULL,
    "shiftId" INTEGER NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "description" TEXT NOT NULL,
    "expenseAccountId" INTEGER NOT NULL,
    "voucherId" INTEGER,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_expenditures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_receipts" (
    "id" SERIAL NOT NULL,
    "shiftId" INTEGER NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "accountId" INTEGER NOT NULL,
    "note" TEXT,
    "voucherId" INTEGER,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_handovers" (
    "id" SERIAL NOT NULL,
    "fromShiftId" INTEGER NOT NULL,
    "toUserId" INTEGER NOT NULL,
    "toShiftId" INTEGER,
    "status" "PosHandoverStatus" NOT NULL DEFAULT 'PENDING',
    "declaredByAPaise" BIGINT NOT NULL,
    "countedByBPaise" BIGINT,
    "carryOverPaise" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_handovers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "departmentId" TEXT NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "module" TEXT NOT NULL DEFAULT 'core',
    "systemOnly" BOOLEAN NOT NULL DEFAULT false,

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
CREATE TABLE "DepartmentPermission" (
    "departmentId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "DepartmentPermission_pkey" PRIMARY KEY ("departmentId","permissionId")
);

-- CreateTable
CREATE TABLE "delivery_methods" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "configJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WallPost" (
    "id" SERIAL NOT NULL,
    "ownerKind" "SocialActorKind" NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "authorKind" "SocialActorKind" NOT NULL,
    "authorId" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WallPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WallPostLike" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "likerKind" "SocialActorKind" NOT NULL,
    "likerId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WallPostLike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WallPostComment" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "authorKind" "SocialActorKind" NOT NULL,
    "authorId" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WallPostComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialConnection" (
    "id" SERIAL NOT NULL,
    "requesterId" INTEGER NOT NULL,
    "addresseeId" INTEGER NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "SocialConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerSocialProfile" (
    "id" SERIAL NOT NULL,
    "personId" INTEGER NOT NULL,
    "handle" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "coverUrl" TEXT,
    "bio" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerSocialProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" SERIAL NOT NULL,
    "pipelineId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'S1',
    "workerId" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "title" TEXT,
    "notes" TEXT,
    "category" TEXT,
    "createdBy" JSONB NOT NULL DEFAULT '{}',
    "assignedPositionId" TEXT,
    "accountId" INTEGER,
    "dueAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "wakeAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "retryKeyId" TEXT,
    "parentTicketId" INTEGER,
    "parentWorkerId" TEXT,
    "context" JSONB,
    "recurrenceId" INTEGER,
    "occurrenceNo" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "statusEnteredAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketRepair" (
    "ticketId" INTEGER NOT NULL,
    "deviceId" INTEGER NOT NULL,
    "serviceCenterId" INTEGER,
    "estimatedCost" DOUBLE PRECISION,
    "accessInfo" TEXT,
    "accessories" TEXT,
    "expectedReturn" TIMESTAMP(3),
    "receivedBackAt" TIMESTAMP(3),
    "externalRef" TEXT,
    "voidReason" TEXT,
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "escalatedAt" TIMESTAMP(3),
    "escalationType" "EscalationType",
    "isWarranty" BOOLEAN NOT NULL DEFAULT false,
    "warrantyStatus" "WarrantyStatus" NOT NULL DEFAULT 'NONE',
    "warrantyRef" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "sourceOrderTicketId" INTEGER,

    CONSTRAINT "TicketRepair_pkey" PRIMARY KEY ("ticketId")
);

-- CreateTable
CREATE TABLE "TicketDeal" (
    "ticketId" INTEGER NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "companyName" TEXT,
    "personId" INTEGER,
    "companyId" INTEGER,
    "valuePaise" INTEGER,
    "source" TEXT,
    "lostReason" TEXT,

    CONSTRAINT "TicketDeal_pkey" PRIMARY KEY ("ticketId")
);

-- CreateTable
CREATE TABLE "TicketOrder" (
    "ticketId" INTEGER NOT NULL,
    "legacyStatus" "ShopOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "orderSource" "OrderSource" NOT NULL DEFAULT 'ONLINE',
    "paymentMethod" "ShopPaymentMethod" NOT NULL DEFAULT 'COD',
    "personId" INTEGER,
    "guestEmail" TEXT,
    "guestPhone" TEXT,
    "shippingName" TEXT,
    "shippingAddress" JSONB,
    "totalPaise" INTEGER NOT NULL DEFAULT 0,
    "shippingChargePaise" INTEGER NOT NULL DEFAULT 0,
    "tierDiscountPaise" INTEGER NOT NULL DEFAULT 0,
    "tierDiscountPct" DECIMAL(5,2),
    "tierLabel" TEXT,
    "couponId" INTEGER,
    "couponCode" TEXT,
    "couponDiscountPaise" INTEGER NOT NULL DEFAULT 0,
    "couponRedemptionId" INTEGER,
    "freeCouponId" INTEGER,
    "freeCouponCode" TEXT,
    "freeCouponRedemptionId" INTEGER,
    "onTopCouponId" INTEGER,
    "onTopCouponCode" TEXT,
    "onTopDiscountPaise" INTEGER NOT NULL DEFAULT 0,
    "onTopRedemptionId" INTEGER,
    "loyaltyRedeemPoints" INTEGER NOT NULL DEFAULT 0,
    "loyaltyRedeemPaise" INTEGER NOT NULL DEFAULT 0,
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "courier" TEXT,
    "trackingNumber" TEXT,
    "paidAt" TIMESTAMP(3),
    "packedAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),

    CONSTRAINT "TicketOrder_pkey" PRIMARY KEY ("ticketId")
);

-- CreateTable
CREATE TABLE "TicketOrderLine" (
    "id" SERIAL NOT NULL,
    "orderTicketId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "freeQty" INTEGER NOT NULL DEFAULT 0,
    "unitPricePaise" INTEGER NOT NULL,
    "tierDiscountPaise" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TicketOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketDelivery" (
    "ticketId" INTEGER NOT NULL,
    "orderSource" TEXT NOT NULL,
    "orderId" INTEGER NOT NULL,
    "carrier" TEXT,
    "awb" TEXT,
    "trackingUrl" TEXT,
    "addressJson" JSONB,
    "chargeToCustomerPaise" INTEGER NOT NULL DEFAULT 0,
    "costToCarrierPaise" INTEGER NOT NULL DEFAULT 0,
    "shiprocketOrderId" TEXT,
    "shipmentId" TEXT,

    CONSTRAINT "TicketDelivery_pkey" PRIMARY KEY ("ticketId")
);

-- CreateTable
CREATE TABLE "TicketRefund" (
    "ticketId" INTEGER NOT NULL,
    "orderSource" TEXT NOT NULL,
    "orderId" INTEGER NOT NULL,
    "amountPaise" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "sourceVoucherId" INTEGER,
    "payoutVoucherId" INTEGER,

    CONSTRAINT "TicketRefund_pkey" PRIMARY KEY ("ticketId")
);

-- CreateTable
CREATE TABLE "TicketHelp" (
    "ticketId" INTEGER NOT NULL,
    "personId" INTEGER,
    "companyId" INTEGER,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "inquiryType" TEXT,
    "subject" TEXT,
    "outcome" "HelpOutcome",

    CONSTRAINT "TicketHelp_pkey" PRIMARY KEY ("ticketId")
);

-- CreateTable
CREATE TABLE "TicketLog" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER,
    "personId" INTEGER,
    "companyId" INTEGER,
    "author" JSONB NOT NULL DEFAULT '{}',
    "kind" "TicketLogKind" NOT NULL DEFAULT 'NOTE',
    "note" TEXT,
    "status" TEXT,
    "workerId" TEXT,
    "visibility" "LogVisibility" NOT NULL DEFAULT 'INTERNAL',
    "dueAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "outcome" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketParticipant" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "addedById" INTEGER NOT NULL,
    "addedForRole" TEXT,
    "addedByWorkerId" TEXT,
    "removedAt" TIMESTAMP(3),
    "removedByWorkerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "accountId" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "TaskRecurrence" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "category" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "pipelineId" TEXT NOT NULL DEFAULT 'P4',
    "assignedPositionId" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'month',
    "every" INTEGER NOT NULL DEFAULT 1,
    "totalCount" INTEGER,
    "anchorAt" TIMESTAMP(3) NOT NULL,
    "lastOccurrenceNo" INTEGER NOT NULL DEFAULT 0,
    "leadDays" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "endedAt" TIMESTAMP(3),
    "amountPaise" INTEGER,
    "accountId" INTEGER,
    "createdBy" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskRecurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT,
    "title" TEXT,
    "scope" "UserScope" NOT NULL DEFAULT 'OWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tokensValidFrom" TIMESTAMP(3),
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
CREATE TABLE "UserSurfaceSeen" (
    "userId" INTEGER NOT NULL,
    "surface" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSurfaceSeen_pkey" PRIMARY KEY ("userId","surface")
);

-- CreateTable
CREATE TABLE "QuickNote" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuickNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedFilter" (
    "id" SERIAL NOT NULL,
    "surface" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerUserId" INTEGER NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedFilter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountGroup_parentId_sortOrder_idx" ON "AccountGroup"("parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "AccountGroup_type_idx" ON "AccountGroup"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Account_code_key" ON "Account"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Account_personId_key" ON "Account"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_companyId_key" ON "Account"("companyId");

-- CreateIndex
CREATE INDEX "Account_isActive_idx" ON "Account"("isActive");

-- CreateIndex
CREATE INDEX "Account_personId_idx" ON "Account"("personId");

-- CreateIndex
CREATE INDEX "Account_companyId_idx" ON "Account"("companyId");

-- CreateIndex
CREATE INDEX "Account_groupId_idx" ON "Account"("groupId");

-- CreateIndex
CREATE INDEX "Account_updatedAt_idx" ON "Account"("updatedAt");

-- CreateIndex
CREATE INDEX "AccountAlias_accountId_idx" ON "AccountAlias"("accountId");

-- CreateIndex
CREATE INDEX "AccountAlias_aliasKey_idx" ON "AccountAlias"("aliasKey");

-- CreateIndex
CREATE INDEX "CustomerTierPeriod_enabled_idx" ON "CustomerTierPeriod"("enabled");

-- CreateIndex
CREATE INDEX "CustomerTier_enabled_idx" ON "CustomerTier"("enabled");

-- CreateIndex
CREATE INDEX "CustomerTier_periodId_idx" ON "CustomerTier"("periodId");

-- CreateIndex
CREATE INDEX "Person_updatedAt_idx" ON "Person"("updatedAt");

-- CreateIndex
CREATE INDEX "Company_updatedAt_idx" ON "Company"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerGroup_name_key" ON "CustomerGroup"("name");

-- CreateIndex
CREATE INDEX "PersonCompany_personId_idx" ON "PersonCompany"("personId");

-- CreateIndex
CREATE INDEX "PersonCompany_companyId_idx" ON "PersonCompany"("companyId");

-- CreateIndex
CREATE INDEX "PersonCompany_updatedAt_idx" ON "PersonCompany"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Phone_phone_key" ON "Phone"("phone");

-- CreateIndex
CREATE INDEX "Phone_personId_idx" ON "Phone"("personId");

-- CreateIndex
CREATE INDEX "Phone_companyId_idx" ON "Phone"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Email_email_key" ON "Email"("email");

-- CreateIndex
CREATE INDEX "Email_personId_idx" ON "Email"("personId");

-- CreateIndex
CREATE INDEX "Email_companyId_idx" ON "Email"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Call_raw_key" ON "Call"("raw");

-- CreateIndex
CREATE INDEX "Call_phone_idx" ON "Call"("phone");

-- CreateIndex
CREATE INDEX "Call_occurredAt_idx" ON "Call"("occurredAt");

-- CreateIndex
CREATE INDEX "Call_spam_idx" ON "Call"("spam");

-- CreateIndex
CREATE INDEX "Call_sourceHost_occurredAt_idx" ON "Call"("sourceHost", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

-- CreateIndex
CREATE INDEX "Coupon_applyMode_isActive_idx" ON "Coupon"("applyMode", "isActive");

-- CreateIndex
CREATE INDEX "Coupon_channels_isActive_idx" ON "Coupon"("channels", "isActive");

-- CreateIndex
CREATE INDEX "Coupon_ownerAccountId_idx" ON "Coupon"("ownerAccountId");

-- CreateIndex
CREATE INDEX "Coupon_issuedByMilestoneId_idx" ON "Coupon"("issuedByMilestoneId");

-- CreateIndex
CREATE INDEX "CouponProductRule_couponId_kind_idx" ON "CouponProductRule"("couponId", "kind");

-- CreateIndex
CREATE INDEX "CouponRedemption_couponId_idx" ON "CouponRedemption"("couponId");

-- CreateIndex
CREATE INDEX "CouponRedemption_accountId_idx" ON "CouponRedemption"("accountId");

-- CreateIndex
CREATE INDEX "CouponRedemption_universalVoucherId_idx" ON "CouponRedemption"("universalVoucherId");

-- CreateIndex
CREATE INDEX "CouponRedemption_updatedAt_idx" ON "CouponRedemption"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCard_code_key" ON "GiftCard"("code");

-- CreateIndex
CREATE INDEX "GiftCard_status_idx" ON "GiftCard"("status");

-- CreateIndex
CREATE INDEX "GiftCard_ownerAccountId_idx" ON "GiftCard"("ownerAccountId");

-- CreateIndex
CREATE INDEX "GiftCardTxn_giftCardId_idx" ON "GiftCardTxn"("giftCardId");

-- CreateIndex
CREATE INDEX "GiftCardTxn_universalVoucherId_idx" ON "GiftCardTxn"("universalVoucherId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_originalRef_idx" ON "AuditLog"("entityType", "originalRef");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_restoredAt_idx" ON "AuditLog"("restoredAt");

-- CreateIndex
CREATE INDEX "UniversalVoucher_status_date_idx" ON "UniversalVoucher"("status", "date");

-- CreateIndex
CREATE INDEX "UniversalVoucher_date_idx" ON "UniversalVoucher"("date");

-- CreateIndex
CREATE INDEX "UniversalVoucher_type_status_idx" ON "UniversalVoucher"("type", "status");

-- CreateIndex
CREATE INDEX "UniversalVoucher_deletedAt_idx" ON "UniversalVoucher"("deletedAt");

-- CreateIndex
CREATE INDEX "UniversalVoucher_partyAccountId_idx" ON "UniversalVoucher"("partyAccountId");

-- CreateIndex
CREATE INDEX "UniversalVoucher_branchId_idx" ON "UniversalVoucher"("branchId");

-- CreateIndex
CREATE INDEX "UniversalVoucher_updatedAt_idx" ON "UniversalVoucher"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherGlLine_sourceJournalLineId_key" ON "VoucherGlLine"("sourceJournalLineId");

-- CreateIndex
CREATE INDEX "VoucherGlLine_accountId_idx" ON "VoucherGlLine"("accountId");

-- CreateIndex
CREATE INDEX "VoucherGlLine_universalVoucherId_idx" ON "VoucherGlLine"("universalVoucherId");

-- CreateIndex
CREATE INDEX "VoucherGlLine_accountId_universalVoucherId_idx" ON "VoucherGlLine"("accountId", "universalVoucherId");

-- CreateIndex
CREATE INDEX "VoucherGlLine_branchId_accountId_idx" ON "VoucherGlLine"("branchId", "accountId");

-- CreateIndex
CREATE INDEX "VoucherLink_kind_targetId_idx" ON "VoucherLink"("kind", "targetId");

-- CreateIndex
CREATE INDEX "VoucherLink_universalVoucherId_idx" ON "VoucherLink"("universalVoucherId");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherLink_universalVoucherId_kind_key" ON "VoucherLink"("universalVoucherId", "kind");

-- CreateIndex
CREATE INDEX "VoucherAllocation_targetType_targetId_idx" ON "VoucherAllocation"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "VoucherAllocation_sourceType_sourceId_idx" ON "VoucherAllocation"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "VoucherAllocation_method_idx" ON "VoucherAllocation"("method");

-- CreateIndex
CREATE UNIQUE INDEX "ChatRoom_key_key" ON "ChatRoom"("key");

-- CreateIndex
CREATE INDEX "ChatRoom_type_idx" ON "ChatRoom"("type");

-- CreateIndex
CREATE INDEX "ChatRoom_ownerUserId_idx" ON "ChatRoom"("ownerUserId");

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
CREATE UNIQUE INDEX "GstRate_label_key" ON "GstRate"("label");

-- CreateIndex
CREATE UNIQUE INDEX "InvCategory_slug_key" ON "InvCategory"("slug");

-- CreateIndex
CREATE INDEX "InvCategory_parentId_idx" ON "InvCategory"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "InvProductGroup_slug_key" ON "InvProductGroup"("slug");

-- CreateIndex
CREATE INDEX "InvProductGroup_parentId_idx" ON "InvProductGroup"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "InvProductGroup_name_key" ON "InvProductGroup"("name");

-- CreateIndex
CREATE UNIQUE INDEX "InvBrand_slug_key" ON "InvBrand"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "InvBrand_name_key" ON "InvBrand"("name");

-- CreateIndex
CREATE INDEX "InvAttributeMaster_categoryId_idx" ON "InvAttributeMaster"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "InvAttributeMaster_key_categoryId_key" ON "InvAttributeMaster"("key", "categoryId");

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
CREATE INDEX "InvProduct_gstRateId_idx" ON "InvProduct"("gstRateId");

-- CreateIndex
CREATE INDEX "InvProduct_isListedInShop_idx" ON "InvProduct"("isListedInShop");

-- CreateIndex
CREATE INDEX "InvProduct_updatedAt_idx" ON "InvProduct"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "product_protection_productId_key" ON "product_protection"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "inv_product_codes_value_key" ON "inv_product_codes"("value");

-- CreateIndex
CREATE INDEX "inv_product_codes_productId_idx" ON "inv_product_codes"("productId");

-- CreateIndex
CREATE INDEX "inv_product_branches_branchId_idx" ON "inv_product_branches"("branchId");

-- CreateIndex
CREATE INDEX "stock_reservations_orderSource_orderId_idx" ON "stock_reservations"("orderSource", "orderId");

-- CreateIndex
CREATE INDEX "stock_reservations_productId_status_idx" ON "stock_reservations"("productId", "status");

-- CreateIndex
CREATE INDEX "redemption_holds_orderSource_orderId_idx" ON "redemption_holds"("orderSource", "orderId");

-- CreateIndex
CREATE INDEX "redemption_holds_rewardType_status_idx" ON "redemption_holds"("rewardType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherDetail_universalVoucherId_key" ON "VoucherDetail"("universalVoucherId");

-- CreateIndex
CREATE INDEX "VoucherDetail_refVoucherId_idx" ON "VoucherDetail"("refVoucherId");

-- CreateIndex
CREATE INDEX "VoucherDetail_updatedAt_idx" ON "VoucherDetail"("updatedAt");

-- CreateIndex
CREATE INDEX "VoucherInventoryLine_universalVoucherId_idx" ON "VoucherInventoryLine"("universalVoucherId");

-- CreateIndex
CREATE INDEX "VoucherInventoryLine_productId_idx" ON "VoucherInventoryLine"("productId");

-- CreateIndex
CREATE INDEX "InvStockLedger_productId_date_idx" ON "InvStockLedger"("productId", "date");

-- CreateIndex
CREATE INDEX "InvStockLedger_universalVoucherId_idx" ON "InvStockLedger"("universalVoucherId");

-- CreateIndex
CREATE INDEX "InvStockLedger_productId_branchId_date_idx" ON "InvStockLedger"("productId", "branchId", "date");

-- CreateIndex
CREATE INDEX "InvBom_outputProductId_idx" ON "InvBom"("outputProductId");

-- CreateIndex
CREATE INDEX "InvBom_isActive_idx" ON "InvBom"("isActive");

-- CreateIndex
CREATE INDEX "InvBomLine_bomId_idx" ON "InvBomLine"("bomId");

-- CreateIndex
CREATE INDEX "InvBomLine_productId_idx" ON "InvBomLine"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_points_dimension_refKey_key" ON "strategy_points"("dimension", "refKey");

-- CreateIndex
CREATE INDEX "additional_cost_allocations_sourceVoucherGlLineId_idx" ON "additional_cost_allocations"("sourceVoucherGlLineId");

-- CreateIndex
CREATE INDEX "additional_cost_allocations_productId_createdAt_idx" ON "additional_cost_allocations"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "additional_cost_allocations_sourceUniversalVoucherId_idx" ON "additional_cost_allocations"("sourceUniversalVoucherId");

-- CreateIndex
CREATE INDEX "additional_cost_allocations_kind_idx" ON "additional_cost_allocations"("kind");

-- CreateIndex
CREATE INDEX "LoyaltyEarnRule_scope_idx" ON "LoyaltyEarnRule"("scope");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyEarnRule_scope_categoryId_groupId_productId_key" ON "LoyaltyEarnRule"("scope", "categoryId", "groupId", "productId");

-- CreateIndex
CREATE INDEX "LoyaltyMilestone_enabled_idx" ON "LoyaltyMilestone"("enabled");

-- CreateIndex
CREATE INDEX "LoyaltyMilestoneAward_accountId_idx" ON "LoyaltyMilestoneAward"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyMilestoneAward_accountId_milestoneId_key" ON "LoyaltyMilestoneAward"("accountId", "milestoneId");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyAccount_accountId_key" ON "LoyaltyAccount"("accountId");

-- CreateIndex
CREATE INDEX "LoyaltyAccount_accountId_idx" ON "LoyaltyAccount"("accountId");

-- CreateIndex
CREATE INDEX "LoyaltyLot_accountId_earnedAt_idx" ON "LoyaltyLot"("accountId", "earnedAt");

-- CreateIndex
CREATE INDEX "LoyaltyLot_universalVoucherId_idx" ON "LoyaltyLot"("universalVoucherId");

-- CreateIndex
CREATE INDEX "LoyaltyLedger_accountId_createdAt_idx" ON "LoyaltyLedger"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "LoyaltyLedger_universalVoucherId_idx" ON "LoyaltyLedger"("universalVoucherId");

-- CreateIndex
CREATE INDEX "PositionRole_roleId_idx" ON "PositionRole"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "Pipeline_name_key" ON "Pipeline"("name");

-- CreateIndex
CREATE INDEX "WorkGroupWork_workId_idx" ON "WorkGroupWork"("workId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerTransition_fromWorkerId_toWorkerId_key" ON "WorkerTransition"("fromWorkerId", "toWorkerId");

-- CreateIndex
CREATE UNIQUE INDEX "StatusTransition_fromStatusId_toStatusId_key" ON "StatusTransition"("fromStatusId", "toStatusId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonPortalCredential_personId_key" ON "PersonPortalCredential"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonPortalCredential_phoneNormalized_key" ON "PersonPortalCredential"("phoneNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "PersonPortalCredential_emailNormalized_key" ON "PersonPortalCredential"("emailNormalized");

-- CreateIndex
CREATE INDEX "PersonPortalCredential_personId_idx" ON "PersonPortalCredential"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "pos_counters_tillAccountId_key" ON "pos_counters"("tillAccountId");

-- CreateIndex
CREATE INDEX "pos_counters_branchId_idx" ON "pos_counters"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "pos_counters_branchId_name_key" ON "pos_counters"("branchId", "name");

-- CreateIndex
CREATE INDEX "pos_counter_payment_accounts_counterId_idx" ON "pos_counter_payment_accounts"("counterId");

-- CreateIndex
CREATE INDEX "pos_counter_payment_accounts_accountId_idx" ON "pos_counter_payment_accounts"("accountId");

-- CreateIndex
CREATE INDEX "pos_counter_payment_accounts_gatewayId_idx" ON "pos_counter_payment_accounts"("gatewayId");

-- CreateIndex
CREATE INDEX "payment_gateways_provider_idx" ON "payment_gateways"("provider");

-- CreateIndex
CREATE INDEX "payment_gateways_enabledForOnline_idx" ON "payment_gateways"("enabledForOnline");

-- CreateIndex
CREATE UNIQUE INDEX "pos_services_name_key" ON "pos_services"("name");

-- CreateIndex
CREATE INDEX "pos_services_isActive_sortOrder_idx" ON "pos_services"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "pos_shifts_userId_status_idx" ON "pos_shifts"("userId", "status");

-- CreateIndex
CREATE INDEX "pos_shifts_branchId_openedAt_idx" ON "pos_shifts"("branchId", "openedAt");

-- CreateIndex
CREATE INDEX "pos_shifts_counterId_status_idx" ON "pos_shifts"("counterId", "status");

-- CreateIndex
CREATE INDEX "pos_shifts_updatedAt_idx" ON "pos_shifts"("updatedAt");

-- CreateIndex
CREATE INDEX "pos_cash_drops_shiftId_droppedAt_idx" ON "pos_cash_drops"("shiftId", "droppedAt");

-- CreateIndex
CREATE UNIQUE INDEX "pos_expenditures_voucherId_key" ON "pos_expenditures"("voucherId");

-- CreateIndex
CREATE INDEX "pos_expenditures_shiftId_createdAt_idx" ON "pos_expenditures"("shiftId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "pos_receipts_voucherId_key" ON "pos_receipts"("voucherId");

-- CreateIndex
CREATE INDEX "pos_receipts_shiftId_createdAt_idx" ON "pos_receipts"("shiftId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "pos_handovers_fromShiftId_key" ON "pos_handovers"("fromShiftId");

-- CreateIndex
CREATE UNIQUE INDEX "pos_handovers_toShiftId_key" ON "pos_handovers"("toShiftId");

-- CreateIndex
CREATE INDEX "pos_handovers_updatedAt_idx" ON "pos_handovers"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserPermission_userId_permissionId_key" ON "UserPermission"("userId", "permissionId");

-- CreateIndex
CREATE INDEX "delivery_methods_kind_idx" ON "delivery_methods"("kind");

-- CreateIndex
CREATE INDEX "WallPost_ownerKind_ownerId_createdAt_idx" ON "WallPost"("ownerKind", "ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "WallPost_authorKind_authorId_idx" ON "WallPost"("authorKind", "authorId");

-- CreateIndex
CREATE INDEX "WallPostLike_postId_idx" ON "WallPostLike"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "WallPostLike_postId_likerKind_likerId_key" ON "WallPostLike"("postId", "likerKind", "likerId");

-- CreateIndex
CREATE INDEX "WallPostComment_postId_createdAt_idx" ON "WallPostComment"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "SocialConnection_addresseeId_status_idx" ON "SocialConnection"("addresseeId", "status");

-- CreateIndex
CREATE INDEX "SocialConnection_requesterId_status_idx" ON "SocialConnection"("requesterId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SocialConnection_requesterId_addresseeId_key" ON "SocialConnection"("requesterId", "addresseeId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSocialProfile_personId_key" ON "CustomerSocialProfile"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSocialProfile_handle_key" ON "CustomerSocialProfile"("handle");

-- CreateIndex
CREATE INDEX "CustomerSocialProfile_handle_idx" ON "CustomerSocialProfile"("handle");

-- CreateIndex
CREATE INDEX "Ticket_parentTicketId_idx" ON "Ticket"("parentTicketId");

-- CreateIndex
CREATE INDEX "Ticket_status_idx" ON "Ticket"("status");

-- CreateIndex
CREATE INDEX "Ticket_pipelineId_status_idx" ON "Ticket"("pipelineId", "status");

-- CreateIndex
CREATE INDEX "Ticket_assignedPositionId_idx" ON "Ticket"("assignedPositionId");

-- CreateIndex
CREATE INDEX "Ticket_accountId_idx" ON "Ticket"("accountId");

-- CreateIndex
CREATE INDEX "Ticket_createdAt_idx" ON "Ticket"("createdAt");

-- CreateIndex
CREATE INDEX "Ticket_wakeAt_idx" ON "Ticket"("wakeAt");

-- CreateIndex
CREATE INDEX "Ticket_recurrenceId_idx" ON "Ticket"("recurrenceId");

-- CreateIndex
CREATE INDEX "Ticket_updatedAt_idx" ON "Ticket"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_recurrenceId_occurrenceNo_key" ON "Ticket"("recurrenceId", "occurrenceNo");

-- CreateIndex
CREATE INDEX "TicketRepair_deviceId_idx" ON "TicketRepair"("deviceId");

-- CreateIndex
CREATE INDEX "TicketRepair_serviceCenterId_idx" ON "TicketRepair"("serviceCenterId");

-- CreateIndex
CREATE INDEX "TicketRepair_warrantyStatus_idx" ON "TicketRepair"("warrantyStatus");

-- CreateIndex
CREATE INDEX "TicketRepair_sourceOrderTicketId_idx" ON "TicketRepair"("sourceOrderTicketId");

-- CreateIndex
CREATE INDEX "TicketDeal_personId_idx" ON "TicketDeal"("personId");

-- CreateIndex
CREATE INDEX "TicketDeal_companyId_idx" ON "TicketDeal"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketOrder_razorpayOrderId_key" ON "TicketOrder"("razorpayOrderId");

-- CreateIndex
CREATE INDEX "TicketOrder_personId_idx" ON "TicketOrder"("personId");

-- CreateIndex
CREATE INDEX "TicketOrderLine_orderTicketId_idx" ON "TicketOrderLine"("orderTicketId");

-- CreateIndex
CREATE INDEX "TicketOrderLine_productId_idx" ON "TicketOrderLine"("productId");

-- CreateIndex
CREATE INDEX "TicketDelivery_orderSource_orderId_idx" ON "TicketDelivery"("orderSource", "orderId");

-- CreateIndex
CREATE INDEX "TicketRefund_orderSource_orderId_idx" ON "TicketRefund"("orderSource", "orderId");

-- CreateIndex
CREATE INDEX "TicketHelp_personId_idx" ON "TicketHelp"("personId");

-- CreateIndex
CREATE INDEX "TicketHelp_companyId_idx" ON "TicketHelp"("companyId");

-- CreateIndex
CREATE INDEX "TicketHelp_outcome_idx" ON "TicketHelp"("outcome");

-- CreateIndex
CREATE INDEX "TicketLog_ticketId_idx" ON "TicketLog"("ticketId");

-- CreateIndex
CREATE INDEX "TicketLog_personId_createdAt_idx" ON "TicketLog"("personId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketLog_companyId_createdAt_idx" ON "TicketLog"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketParticipant_ticketId_idx" ON "TicketParticipant"("ticketId");

-- CreateIndex
CREATE INDEX "TicketParticipant_userId_idx" ON "TicketParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketParticipant_ticketId_userId_addedByWorkerId_key" ON "TicketParticipant"("ticketId", "userId", "addedByWorkerId");

-- CreateIndex
CREATE INDEX "Device_accountId_idx" ON "Device"("accountId");

-- CreateIndex
CREATE INDEX "Device_updatedAt_idx" ON "Device"("updatedAt");

-- CreateIndex
CREATE INDEX "TaskRecurrence_isActive_endedAt_idx" ON "TaskRecurrence"("isActive", "endedAt");

-- CreateIndex
CREATE INDEX "TaskRecurrence_assignedPositionId_idx" ON "TaskRecurrence"("assignedPositionId");

-- CreateIndex
CREATE INDEX "TaskRecurrence_accountId_idx" ON "TaskRecurrence"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "QuickNote_userId_idx" ON "QuickNote"("userId");

-- CreateIndex
CREATE INDEX "SavedFilter_surface_ownerUserId_idx" ON "SavedFilter"("surface", "ownerUserId");

-- CreateIndex
CREATE INDEX "SavedFilter_surface_isShared_idx" ON "SavedFilter"("surface", "isShared");

-- AddForeignKey
ALTER TABLE "AccountGroup" ADD CONSTRAINT "AccountGroup_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AccountGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AccountGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_reconciledById_fkey" FOREIGN KEY ("reconciledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountAlias" ADD CONSTRAINT "AccountAlias_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerTier" ADD CONSTRAINT "CustomerTier_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "CustomerTierPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_customerGroupId_fkey" FOREIGN KEY ("customerGroupId") REFERENCES "CustomerGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_ownerPositionId_fkey" FOREIGN KEY ("ownerPositionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_convertedToCompanyId_fkey" FOREIGN KEY ("convertedToCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_mergedIntoPersonId_fkey" FOREIGN KEY ("mergedIntoPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_customerGroupId_fkey" FOREIGN KEY ("customerGroupId") REFERENCES "CustomerGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_ownerPositionId_fkey" FOREIGN KEY ("ownerPositionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_convertedToPersonId_fkey" FOREIGN KEY ("convertedToPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_mergedIntoCompanyId_fkey" FOREIGN KEY ("mergedIntoCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonCompany" ADD CONSTRAINT "PersonCompany_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonCompany" ADD CONSTRAINT "PersonCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Phone" ADD CONSTRAINT "Phone_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Phone" ADD CONSTRAINT "Phone_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Email" ADD CONSTRAINT "Email_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Email" ADD CONSTRAINT "Email_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_freeProductId_fkey" FOREIGN KEY ("freeProductId") REFERENCES "InvProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_buyProductId_fkey" FOREIGN KEY ("buyProductId") REFERENCES "InvProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_ownerAccountId_fkey" FOREIGN KEY ("ownerAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_issuedByMilestoneId_fkey" FOREIGN KEY ("issuedByMilestoneId") REFERENCES "LoyaltyMilestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponProductRule" ADD CONSTRAINT "CouponProductRule_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponProductRule" ADD CONSTRAINT "CouponProductRule_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InvProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponProductRule" ADD CONSTRAINT "CouponProductRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "InvCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponProductRule" ADD CONSTRAINT "CouponProductRule_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "InvProductGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponProductRule" ADD CONSTRAINT "CouponProductRule_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "InvBrand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_universalVoucherId_fkey" FOREIGN KEY ("universalVoucherId") REFERENCES "UniversalVoucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_ownerAccountId_fkey" FOREIGN KEY ("ownerAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardTxn" ADD CONSTRAINT "GiftCardTxn_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "GiftCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardTxn" ADD CONSTRAINT "GiftCardTxn_universalVoucherId_fkey" FOREIGN KEY ("universalVoucherId") REFERENCES "UniversalVoucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardTxn" ADD CONSTRAINT "GiftCardTxn_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponConfig" ADD CONSTRAINT "CouponConfig_couponExpenseAccountId_fkey" FOREIGN KEY ("couponExpenseAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponConfig" ADD CONSTRAINT "CouponConfig_giftCardLiabilityAccountId_fkey" FOREIGN KEY ("giftCardLiabilityAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponConfig" ADD CONSTRAINT "CouponConfig_giftCardBreakageAccountId_fkey" FOREIGN KEY ("giftCardBreakageAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_restoredById_fkey" FOREIGN KEY ("restoredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UniversalVoucher" ADD CONSTRAINT "UniversalVoucher_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherGlLine" ADD CONSTRAINT "VoucherGlLine_universalVoucherId_fkey" FOREIGN KEY ("universalVoucherId") REFERENCES "UniversalVoucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherLink" ADD CONSTRAINT "VoucherLink_universalVoucherId_fkey" FOREIGN KEY ("universalVoucherId") REFERENCES "UniversalVoucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherAllocation" ADD CONSTRAINT "VoucherAllocation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRoom" ADD CONSTRAINT "ChatRoom_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRoomMember" ADD CONSTRAINT "ChatRoomMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "ChatRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRoomMember" ADD CONSTRAINT "ChatRoomMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "ChatRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvUnit" ADD CONSTRAINT "InvUnit_baseUnitId_fkey" FOREIGN KEY ("baseUnitId") REFERENCES "InvUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvCategory" ADD CONSTRAINT "InvCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "InvCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvProductGroup" ADD CONSTRAINT "InvProductGroup_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "InvProductGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvProductGroup" ADD CONSTRAINT "InvProductGroup_gstRateId_fkey" FOREIGN KEY ("gstRateId") REFERENCES "GstRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvAttributeMaster" ADD CONSTRAINT "InvAttributeMaster_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "InvCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvProduct" ADD CONSTRAINT "InvProduct_gstRateId_fkey" FOREIGN KEY ("gstRateId") REFERENCES "GstRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "product_protection" ADD CONSTRAINT "product_protection_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InvProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inv_product_codes" ADD CONSTRAINT "inv_product_codes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InvProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inv_product_branches" ADD CONSTRAINT "inv_product_branches_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InvProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inv_product_branches" ADD CONSTRAINT "inv_product_branches_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InvProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherDetail" ADD CONSTRAINT "VoucherDetail_refVoucherId_fkey" FOREIGN KEY ("refVoucherId") REFERENCES "VoucherDetail"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherDetail" ADD CONSTRAINT "VoucherDetail_universalVoucherId_fkey" FOREIGN KEY ("universalVoucherId") REFERENCES "UniversalVoucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherDetail" ADD CONSTRAINT "VoucherDetail_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "InvBom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherDetail" ADD CONSTRAINT "VoucherDetail_destinationBranchId_fkey" FOREIGN KEY ("destinationBranchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherInventoryLine" ADD CONSTRAINT "VoucherInventoryLine_universalVoucherId_fkey" FOREIGN KEY ("universalVoucherId") REFERENCES "UniversalVoucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherInventoryLine" ADD CONSTRAINT "VoucherInventoryLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InvProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvStockLedger" ADD CONSTRAINT "InvStockLedger_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InvProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvStockLedger" ADD CONSTRAINT "InvStockLedger_universalVoucherId_fkey" FOREIGN KEY ("universalVoucherId") REFERENCES "UniversalVoucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvStockLedger" ADD CONSTRAINT "InvStockLedger_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvBom" ADD CONSTRAINT "InvBom_outputProductId_fkey" FOREIGN KEY ("outputProductId") REFERENCES "InvProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvBomLine" ADD CONSTRAINT "InvBomLine_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "InvBom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvBomLine" ADD CONSTRAINT "InvBomLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InvProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_cost_allocations" ADD CONSTRAINT "additional_cost_allocations_sourceVoucherGlLineId_fkey" FOREIGN KEY ("sourceVoucherGlLineId") REFERENCES "VoucherGlLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_cost_allocations" ADD CONSTRAINT "additional_cost_allocations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InvProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_cost_allocations" ADD CONSTRAINT "additional_cost_allocations_sourceUniversalVoucherId_fkey" FOREIGN KEY ("sourceUniversalVoucherId") REFERENCES "UniversalVoucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_cost_allocations" ADD CONSTRAINT "additional_cost_allocations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyConfig" ADD CONSTRAINT "LoyaltyConfig_redeemExpenseAccountId_fkey" FOREIGN KEY ("redeemExpenseAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyEarnRule" ADD CONSTRAINT "LoyaltyEarnRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "InvCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyEarnRule" ADD CONSTRAINT "LoyaltyEarnRule_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "InvProductGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyEarnRule" ADD CONSTRAINT "LoyaltyEarnRule_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InvProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyMilestone" ADD CONSTRAINT "LoyaltyMilestone_issuesCouponTemplateId_fkey" FOREIGN KEY ("issuesCouponTemplateId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyMilestoneAward" ADD CONSTRAINT "LoyaltyMilestoneAward_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyMilestoneAward" ADD CONSTRAINT "LoyaltyMilestoneAward_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "LoyaltyMilestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyMilestoneAward" ADD CONSTRAINT "LoyaltyMilestoneAward_universalVoucherId_fkey" FOREIGN KEY ("universalVoucherId") REFERENCES "UniversalVoucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyAccount" ADD CONSTRAINT "LoyaltyAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyLot" ADD CONSTRAINT "LoyaltyLot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LoyaltyAccount"("accountId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyLot" ADD CONSTRAINT "LoyaltyLot_universalVoucherId_fkey" FOREIGN KEY ("universalVoucherId") REFERENCES "UniversalVoucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyLedger" ADD CONSTRAINT "LoyaltyLedger_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LoyaltyAccount"("accountId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyLedger" ADD CONSTRAINT "LoyaltyLedger_universalVoucherId_fkey" FOREIGN KEY ("universalVoucherId") REFERENCES "UniversalVoucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyLedger" ADD CONSTRAINT "LoyaltyLedger_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_vaultAccountId_fkey" FOREIGN KEY ("vaultAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_parentPositionId_fkey" FOREIGN KEY ("parentPositionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPosition" ADD CONSTRAINT "UserPosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPosition" ADD CONSTRAINT "UserPosition_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionRole" ADD CONSTRAINT "PositionRole_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionRole" ADD CONSTRAINT "PositionRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgDefaults" ADD CONSTRAINT "OrgDefaults_defaultUnitId_fkey" FOREIGN KEY ("defaultUnitId") REFERENCES "InvUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgDefaults" ADD CONSTRAINT "OrgDefaults_defaultGstRateId_fkey" FOREIGN KEY ("defaultGstRateId") REFERENCES "GstRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgDefaults" ADD CONSTRAINT "OrgDefaults_shippingPoolGroupId_fkey" FOREIGN KEY ("shippingPoolGroupId") REFERENCES "AccountGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketStatus" ADD CONSTRAINT "TicketStatus_resolveGroupId_fkey" FOREIGN KEY ("resolveGroupId") REFERENCES "WorkGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketStatus" ADD CONSTRAINT "TicketStatus_workId_fkey" FOREIGN KEY ("workId") REFERENCES "Work"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketStatus" ADD CONSTRAINT "TicketStatus_startWorkerId_fkey" FOREIGN KEY ("startWorkerId") REFERENCES "TicketWorker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketStatus" ADD CONSTRAINT "TicketStatus_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketWorker" ADD CONSTRAINT "TicketWorker_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "TicketStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketWorker" ADD CONSTRAINT "TicketWorker_successWorkerId_fkey" FOREIGN KEY ("successWorkerId") REFERENCES "TicketWorker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketWorker" ADD CONSTRAINT "TicketWorker_failWorkerId_fkey" FOREIGN KEY ("failWorkerId") REFERENCES "TicketWorker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketWorker" ADD CONSTRAINT "TicketWorker_successStatusId_fkey" FOREIGN KEY ("successStatusId") REFERENCES "TicketStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketWorker" ADD CONSTRAINT "TicketWorker_failStatusId_fkey" FOREIGN KEY ("failStatusId") REFERENCES "TicketStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketWorker" ADD CONSTRAINT "TicketWorker_workId_fkey" FOREIGN KEY ("workId") REFERENCES "Work"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketWorker" ADD CONSTRAINT "TicketWorker_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkGroup" ADD CONSTRAINT "WorkGroup_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkGroupWork" ADD CONSTRAINT "WorkGroupWork_workGroupId_fkey" FOREIGN KEY ("workGroupId") REFERENCES "WorkGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkGroupWork" ADD CONSTRAINT "WorkGroupWork_workId_fkey" FOREIGN KEY ("workId") REFERENCES "Work"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Work" ADD CONSTRAINT "Work_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerTransition" ADD CONSTRAINT "WorkerTransition_fromWorkerId_fkey" FOREIGN KEY ("fromWorkerId") REFERENCES "TicketWorker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerTransition" ADD CONSTRAINT "WorkerTransition_toWorkerId_fkey" FOREIGN KEY ("toWorkerId") REFERENCES "TicketWorker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusTransition" ADD CONSTRAINT "StatusTransition_fromStatusId_fkey" FOREIGN KEY ("fromStatusId") REFERENCES "TicketStatus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusTransition" ADD CONSTRAINT "StatusTransition_toStatusId_fkey" FOREIGN KEY ("toStatusId") REFERENCES "TicketStatus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonPortalCredential" ADD CONSTRAINT "PersonPortalCredential_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_counters" ADD CONSTRAINT "pos_counters_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_counters" ADD CONSTRAINT "pos_counters_tillAccountId_fkey" FOREIGN KEY ("tillAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_counter_payment_accounts" ADD CONSTRAINT "pos_counter_payment_accounts_counterId_fkey" FOREIGN KEY ("counterId") REFERENCES "pos_counters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_counter_payment_accounts" ADD CONSTRAINT "pos_counter_payment_accounts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_counter_payment_accounts" ADD CONSTRAINT "pos_counter_payment_accounts_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES "payment_gateways"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_services" ADD CONSTRAINT "pos_services_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_services" ADD CONSTRAINT "pos_services_gstRateId_fkey" FOREIGN KEY ("gstRateId") REFERENCES "GstRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_counterId_fkey" FOREIGN KEY ("counterId") REFERENCES "pos_counters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_handoverToShiftId_fkey" FOREIGN KEY ("handoverToShiftId") REFERENCES "pos_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_cash_drops" ADD CONSTRAINT "pos_cash_drops_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "pos_shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_cash_drops" ADD CONSTRAINT "pos_cash_drops_droppedById_fkey" FOREIGN KEY ("droppedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_expenditures" ADD CONSTRAINT "pos_expenditures_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "pos_shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_receipts" ADD CONSTRAINT "pos_receipts_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "pos_shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_handovers" ADD CONSTRAINT "pos_handovers_fromShiftId_fkey" FOREIGN KEY ("fromShiftId") REFERENCES "pos_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_handovers" ADD CONSTRAINT "pos_handovers_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_handovers" ADD CONSTRAINT "pos_handovers_toShiftId_fkey" FOREIGN KEY ("toShiftId") REFERENCES "pos_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentPermission" ADD CONSTRAINT "DepartmentPermission_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentPermission" ADD CONSTRAINT "DepartmentPermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WallPostLike" ADD CONSTRAINT "WallPostLike_postId_fkey" FOREIGN KEY ("postId") REFERENCES "WallPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WallPostComment" ADD CONSTRAINT "WallPostComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "WallPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialConnection" ADD CONSTRAINT "SocialConnection_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialConnection" ADD CONSTRAINT "SocialConnection_addresseeId_fkey" FOREIGN KEY ("addresseeId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSocialProfile" ADD CONSTRAINT "CustomerSocialProfile_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assignedPositionId_fkey" FOREIGN KEY ("assignedPositionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_status_fkey" FOREIGN KEY ("status") REFERENCES "TicketStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "TicketWorker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_parentTicketId_fkey" FOREIGN KEY ("parentTicketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_recurrenceId_fkey" FOREIGN KEY ("recurrenceId") REFERENCES "TaskRecurrence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketRepair" ADD CONSTRAINT "TicketRepair_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketRepair" ADD CONSTRAINT "TicketRepair_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketRepair" ADD CONSTRAINT "TicketRepair_serviceCenterId_fkey" FOREIGN KEY ("serviceCenterId") REFERENCES "ServiceCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketDeal" ADD CONSTRAINT "TicketDeal_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketDeal" ADD CONSTRAINT "TicketDeal_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketDeal" ADD CONSTRAINT "TicketDeal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketOrder" ADD CONSTRAINT "TicketOrder_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketOrder" ADD CONSTRAINT "TicketOrder_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketOrderLine" ADD CONSTRAINT "TicketOrderLine_orderTicketId_fkey" FOREIGN KEY ("orderTicketId") REFERENCES "TicketOrder"("ticketId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketOrderLine" ADD CONSTRAINT "TicketOrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InvProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketDelivery" ADD CONSTRAINT "TicketDelivery_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketRefund" ADD CONSTRAINT "TicketRefund_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketHelp" ADD CONSTRAINT "TicketHelp_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketHelp" ADD CONSTRAINT "TicketHelp_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketHelp" ADD CONSTRAINT "TicketHelp_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketLog" ADD CONSTRAINT "TicketLog_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketLog" ADD CONSTRAINT "TicketLog_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketLog" ADD CONSTRAINT "TicketLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketLog" ADD CONSTRAINT "TicketLog_status_fkey" FOREIGN KEY ("status") REFERENCES "TicketStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketLog" ADD CONSTRAINT "TicketLog_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "TicketWorker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketParticipant" ADD CONSTRAINT "TicketParticipant_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketParticipant" ADD CONSTRAINT "TicketParticipant_addedByWorkerId_fkey" FOREIGN KEY ("addedByWorkerId") REFERENCES "TicketWorker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketParticipant" ADD CONSTRAINT "TicketParticipant_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketParticipant" ADD CONSTRAINT "TicketParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskRecurrence" ADD CONSTRAINT "TaskRecurrence_assignedPositionId_fkey" FOREIGN KEY ("assignedPositionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskRecurrence" ADD CONSTRAINT "TaskRecurrence_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_role_fkey" FOREIGN KEY ("role") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSurfaceSeen" ADD CONSTRAINT "UserSurfaceSeen_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickNote" ADD CONSTRAINT "QuickNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedFilter" ADD CONSTRAINT "SavedFilter_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
