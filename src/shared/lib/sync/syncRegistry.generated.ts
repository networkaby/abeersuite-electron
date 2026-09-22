// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Regenerate with: pnpm sync:tables
// Verified by:     pnpm sync:tables --check  (runs in pnpm precommit)
//
// Physical table name -> the Prisma model that owns it. Mirrors
// prisma/sync-tables.json; see gen-sync-registry.ts for why this exists as TS.

export interface SyncRegistryEntry {
    /** Prisma model name, e.g. "InvProductBranch". */
    model: string;
    /** Property on PrismaClient, e.g. "invProductBranch". */
    delegate: string;
    /** Primary-key column names, in order. Compound keys have more than one. */
    pk: string[];
    /** Decimal/BigInt fields — must be parsed as strings to keep their value. */
    exact: string[];
    /** DateTime fields — stored without a zone, so the push path stamps a Z on them. */
    dates: string[];
    /** Running totals rebuilt from the ledger on each side — never sent on an UPDATE. */
    cache: string[];
    /**
     * This machine owns its rows outright; the cloud is never the authority on them.
     * The push path never drops such a row as "superseded" by a newer cloud copy —
     * for VoucherSeriesCounter that drop is a lost increment and a re-issued invoice
     * number. The sync engine reads the same flag to hold its deletes.
     */
    localAuthority?: boolean;
}

export const SYNC_REGISTRY: Record<string, SyncRegistryEntry> = {
    "Account": { model: "Account", delegate: "account", pk: ["id"], exact: ["balance", "creditLimit", "openingBalance"], dates: ["createdAt", "openingBalanceDate", "reconciledAt", "reconciledThrough", "updatedAt"], cache: ["balance"] },
    "AccountAlias": { model: "AccountAlias", delegate: "accountAlias", pk: ["id"], exact: [], dates: ["createdAt"], cache: [] },
    "AccountGroup": { model: "AccountGroup", delegate: "accountGroup", pk: ["id"], exact: [], dates: [], cache: [] },
    "additional_cost_allocations": { model: "AdditionalCostAllocation", delegate: "additionalCostAllocation", pk: ["id"], exact: ["quantity"], dates: ["createdAt", "date"], cache: [] },
    "attendance_days": { model: "AttendanceDay", delegate: "attendanceDay", pk: ["id"], exact: [], dates: ["createdAt", "date", "firstInAt", "lastOutAt", "lastSeenAt", "updatedAt"], cache: [] },
    "attendance_spans": { model: "AttendanceSpan", delegate: "attendanceSpan", pk: ["id"], exact: [], dates: ["createdAt", "date", "endedAt", "startedAt", "updatedAt"], cache: [] },
    "AuditLog": { model: "AuditLog", delegate: "auditLog", pk: ["id"], exact: [], dates: ["createdAt", "restoredAt"], cache: [] },
    "BackupConfig": { model: "BackupConfig", delegate: "backupConfig", pk: ["id"], exact: [], dates: ["lastRunAt", "updatedAt"], cache: [] },
    "BankStatementImport": { model: "BankStatementImport", delegate: "bankStatementImport", pk: ["id"], exact: ["closingBalance", "openingBalance"], dates: ["createdAt", "fromDate", "toDate"], cache: [] },
    "BankStatementLine": { model: "BankStatementLine", delegate: "bankStatementLine", pk: ["id"], exact: ["balance", "deposit", "withdrawal"], dates: ["createdAt", "date"], cache: [] },
    "BankStatementMatch": { model: "BankStatementMatch", delegate: "bankStatementMatch", pk: ["id"], exact: [], dates: ["createdAt"], cache: [] },
    "BiGstPlanningConfig": { model: "BiGstPlanningConfig", delegate: "biGstPlanningConfig", pk: ["id"], exact: ["depositGapPercent", "incomeTaxFreeLimit", "presumptiveRatePercent", "taxRatePercent"], dates: ["updatedAt"], cache: [] },
    "BiGstPlanningFy": { model: "BiGstPlanningFy", delegate: "biGstPlanningFy", pk: ["fyStartYear"], exact: ["allowedDiff"], dates: ["updatedAt"], cache: [] },
    "BiGstPlanningMonth": { model: "BiGstPlanningMonth", delegate: "biGstPlanningMonth", pk: ["yearMonth"], exact: ["depositOverride", "purchaseOverride", "saleOverride"], dates: ["updatedAt"], cache: [] },
    "BooksConfig": { model: "BooksConfig", delegate: "booksConfig", pk: ["id"], exact: [], dates: ["booksBeginningFrom", "updatedAt"], cache: [] },
    "Branch": { model: "Branch", delegate: "branch", pk: ["id"], exact: [], dates: ["createdAt", "updatedAt"], cache: [] },
    "Call": { model: "Call", delegate: "call", pk: ["id"], exact: ["amount"], dates: ["createdAt", "occurredAt", "receivedAt", "updatedAt"], cache: [] },
    "ChatMessage": { model: "ChatMessage", delegate: "chatMessage", pk: ["id"], exact: [], dates: ["createdAt"], cache: [] },
    "ChatRoom": { model: "ChatRoom", delegate: "chatRoom", pk: ["id"], exact: [], dates: ["createdAt", "updatedAt"], cache: [] },
    "ChatRoomMember": { model: "ChatRoomMember", delegate: "chatRoomMember", pk: ["id"], exact: [], dates: ["joinedAt", "lastReadAt"], cache: [] },
    "commission_heads": { model: "CommissionHead", delegate: "commissionHead", pk: ["id"], exact: [], dates: ["createdAt", "updatedAt"], cache: [] },
    "commission_overrides": { model: "CommissionOverride", delegate: "commissionOverride", pk: ["id"], exact: [], dates: ["updatedAt"], cache: [] },
    "Company": { model: "Company", delegate: "company", pk: ["id"], exact: [], dates: ["booksBeginningFrom", "convertedAt", "createdAt", "financialYearFrom", "mergedAt", "updatedAt"], cache: [] },
    "Coupon": { model: "Coupon", delegate: "coupon", pk: ["id"], exact: ["buyQty", "flatAmt", "freeDiscountPct", "freeQty", "getQty", "maxDiscountAmt", "minBillValue", "percentOff", "setPriceAmt"], dates: ["createdAt", "endsAt", "startsAt", "updatedAt"], cache: [] },
    "CouponConfig": { model: "CouponConfig", delegate: "couponConfig", pk: ["id"], exact: ["maxTotalDiscountPct"], dates: ["updatedAt"], cache: [] },
    "CouponProductRule": { model: "CouponProductRule", delegate: "couponProductRule", pk: ["id"], exact: [], dates: [], cache: [] },
    "CouponRedemption": { model: "CouponRedemption", delegate: "couponRedemption", pk: ["id"], exact: ["amount"], dates: ["redeemedAt", "reversedAt", "updatedAt"], cache: [] },
    "CreditLimitConfig": { model: "CreditLimitConfig", delegate: "creditLimitConfig", pk: ["id"], exact: ["maxAutoLimit", "pctOfSales"], dates: ["updatedAt"], cache: [] },
    "CustomerGroup": { model: "CustomerGroup", delegate: "customerGroup", pk: ["id"], exact: [], dates: ["createdAt"], cache: [] },
    "CustomerSocialProfile": { model: "CustomerSocialProfile", delegate: "customerSocialProfile", pk: ["id"], exact: [], dates: ["joinedAt"], cache: [] },
    "CustomerTier": { model: "CustomerTier", delegate: "customerTier", pk: ["id"], exact: ["discountPct", "minSpend"], dates: ["createdAt", "updatedAt"], cache: [] },
    "CustomerTierPeriod": { model: "CustomerTierPeriod", delegate: "customerTierPeriod", pk: ["id"], exact: [], dates: ["createdAt", "updatedAt"], cache: [] },
    "delivery_methods": { model: "DeliveryMethod", delegate: "deliveryMethod", pk: ["id"], exact: [], dates: ["createdAt", "updatedAt"], cache: [] },
    "Department": { model: "Department", delegate: "department", pk: ["id"], exact: [], dates: ["createdAt"], cache: [] },
    "DepartmentPermission": { model: "DepartmentPermission", delegate: "departmentPermission", pk: ["departmentId", "permissionId"], exact: [], dates: [], cache: [] },
    "Device": { model: "Device", delegate: "device", pk: ["id"], exact: [], dates: ["updatedAt"], cache: [] },
    "Email": { model: "Email", delegate: "email", pk: ["id"], exact: [], dates: ["createdAt", "updatedAt", "verifiedAt"], cache: [] },
    "GiftCard": { model: "GiftCard", delegate: "giftCard", pk: ["id"], exact: ["balance", "initialValue"], dates: ["createdAt", "expiresAt", "issuedAt", "updatedAt"], cache: ["balance"] },
    "GiftCardTxn": { model: "GiftCardTxn", delegate: "giftCardTxn", pk: ["id"], exact: ["amount", "balanceAfter"], dates: ["createdAt"], cache: [] },
    "GstRate": { model: "GstRate", delegate: "gstRate", pk: ["id"], exact: ["rate"], dates: [], cache: [] },
    "holidays": { model: "Holiday", delegate: "holiday", pk: ["id"], exact: [], dates: ["createdAt", "date", "updatedAt"], cache: [] },
    "InvAttributeMaster": { model: "InvAttributeMaster", delegate: "invAttributeMaster", pk: ["id"], exact: [], dates: ["createdAt", "updatedAt"], cache: [] },
    "InvBom": { model: "InvBom", delegate: "invBom", pk: ["id"], exact: ["outputQty"], dates: ["createdAt", "updatedAt"], cache: [] },
    "InvBomLine": { model: "InvBomLine", delegate: "invBomLine", pk: ["id"], exact: ["qty"], dates: [], cache: [] },
    "InvBrand": { model: "InvBrand", delegate: "invBrand", pk: ["id"], exact: [], dates: ["createdAt", "updatedAt"], cache: [] },
    "InvCategory": { model: "InvCategory", delegate: "invCategory", pk: ["id"], exact: [], dates: ["createdAt", "updatedAt"], cache: [] },
    "InvNamingConfig": { model: "InvNamingConfig", delegate: "invNamingConfig", pk: ["id"], exact: [], dates: ["updatedAt"], cache: [] },
    "InvProduct": { model: "InvProduct", delegate: "invProduct", pk: ["id"], exact: ["marginPercent", "openingRate", "openingStock", "openingValue"], dates: ["createdAt", "openingStockDate", "salePriceFrozenAt", "updatedAt"], cache: ["stock"] },
    "inv_product_branches": { model: "InvProductBranch", delegate: "invProductBranch", pk: ["productId", "branchId"], exact: [], dates: ["updatedAt"], cache: ["stock"] },
    "inv_product_codes": { model: "InvProductCode", delegate: "invProductCode", pk: ["id"], exact: [], dates: ["createdAt"], cache: [] },
    "InvProductGroup": { model: "InvProductGroup", delegate: "invProductGroup", pk: ["id"], exact: [], dates: ["createdAt", "updatedAt"], cache: [] },
    "InvStockLedger": { model: "InvStockLedger", delegate: "invStockLedger", pk: ["id"], exact: ["amount", "inQty", "outQty", "rate"], dates: ["date"], cache: [] },
    "InvUnit": { model: "InvUnit", delegate: "invUnit", pk: ["id"], exact: [], dates: ["createdAt", "updatedAt"], cache: [] },
    "InvWarrantyTerm": { model: "InvWarrantyTerm", delegate: "invWarrantyTerm", pk: ["id"], exact: [], dates: ["createdAt", "updatedAt"], cache: [] },
    "leave_requests": { model: "LeaveRequest", delegate: "leaveRequest", pk: ["id"], exact: [], dates: ["createdAt", "decidedAt", "fromDate", "toDate", "updatedAt"], cache: [] },
    "leave_types": { model: "LeaveType", delegate: "leaveType", pk: ["id"], exact: [], dates: ["createdAt", "updatedAt"], cache: [] },
    "LoyaltyAccount": { model: "LoyaltyAccount", delegate: "loyaltyAccount", pk: ["id"], exact: [], dates: ["createdAt", "updatedAt"], cache: [] },
    "LoyaltyConfig": { model: "LoyaltyConfig", delegate: "loyaltyConfig", pk: ["id"], exact: ["globalEarnRatePer", "maxRedeemPctOfBill", "minEarnInvoiceValue", "minRedeemInvoiceValue", "redeemValue"], dates: ["updatedAt"], cache: [] },
    "LoyaltyEarnRule": { model: "LoyaltyEarnRule", delegate: "loyaltyEarnRule", pk: ["id"], exact: ["multiplier", "redeemCapPct"], dates: ["createdAt", "updatedAt"], cache: [] },
    "LoyaltyLedger": { model: "LoyaltyLedger", delegate: "loyaltyLedger", pk: ["id"], exact: [], dates: ["createdAt"], cache: [] },
    "LoyaltyLot": { model: "LoyaltyLot", delegate: "loyaltyLot", pk: ["id"], exact: [], dates: ["createdAt", "earnedAt"], cache: [] },
    "LoyaltyMilestone": { model: "LoyaltyMilestone", delegate: "loyaltyMilestone", pk: ["id"], exact: ["threshold"], dates: ["createdAt", "updatedAt"], cache: [] },
    "LoyaltyMilestoneAward": { model: "LoyaltyMilestoneAward", delegate: "loyaltyMilestoneAward", pk: ["id"], exact: [], dates: ["awardedAt"], cache: [] },
    "OfflinePolicy": { model: "OfflinePolicy", delegate: "offlinePolicy", pk: ["id"], exact: [], dates: ["updatedAt"], cache: [] },
    "OrgDefaults": { model: "OrgDefaults", delegate: "orgDefaults", pk: ["id"], exact: ["clearanceMarginCutoffPct"], dates: ["updatedAt"], cache: [] },
    "payment_gateways": { model: "PaymentGateway", delegate: "paymentGateway", pk: ["id"], exact: [], dates: ["createdAt", "updatedAt"], cache: [] },
    "payroll_runs": { model: "PayrollRun", delegate: "payrollRun", pk: ["id"], exact: [], dates: ["createdAt", "periodFrom", "periodTo", "postedAt", "postingDate", "updatedAt"], cache: [] },
    "payroll_run_lines": { model: "PayrollRunLine", delegate: "payrollRunLine", pk: ["id"], exact: [], dates: ["effectiveFrom"], cache: [] },
    "Permission": { model: "Permission", delegate: "permission", pk: ["id"], exact: [], dates: [], cache: [] },
    "Person": { model: "Person", delegate: "person", pk: ["id"], exact: [], dates: ["agreedAt", "convertedAt", "createdAt", "mergedAt", "updatedAt"], cache: [] },
    "PersonCompany": { model: "PersonCompany", delegate: "personCompany", pk: ["id"], exact: [], dates: ["linkedAt", "unlinkedAt", "updatedAt"], cache: [] },
    "PersonPortalCredential": { model: "PersonPortalCredential", delegate: "personPortalCredential", pk: ["id"], exact: [], dates: ["createdAt", "updatedAt"], cache: [] },
    "Phone": { model: "Phone", delegate: "phone", pk: ["id"], exact: [], dates: ["createdAt", "updatedAt", "verifiedAt"], cache: [] },
    "Pipeline": { model: "Pipeline", delegate: "pipeline", pk: ["id"], exact: [], dates: ["createdAt"], cache: [] },
    "pos_cash_drops": { model: "PosCashDrop", delegate: "posCashDrop", pk: ["id"], exact: ["amountPaise"], dates: ["droppedAt"], cache: [] },
    "pos_counters": { model: "PosCounter", delegate: "posCounter", pk: ["id"], exact: [], dates: ["boundAt", "releasedAt"], cache: [] },
    "pos_counter_payment_accounts": { model: "PosCounterPaymentAccount", delegate: "posCounterPaymentAccount", pk: ["id"], exact: [], dates: [], cache: [] },
    "pos_handovers": { model: "PosHandover", delegate: "posHandover", pk: ["id"], exact: ["carryOverPaise", "countedByBPaise", "declaredByAPaise"], dates: ["acceptedAt", "initiatedAt", "updatedAt"], cache: [] },
    "Position": { model: "Position", delegate: "position", pk: ["id"], exact: [], dates: ["createdAt"], cache: [] },
    "PositionRole": { model: "PositionRole", delegate: "positionRole", pk: ["positionId", "roleId"], exact: [], dates: [], cache: [] },
    "pos_services": { model: "PosService", delegate: "posService", pk: ["id"], exact: [], dates: ["createdAt", "updatedAt"], cache: [] },
    "pos_shifts": { model: "PosShift", delegate: "posShift", pk: ["id"], exact: ["carryOverFloatPaise", "carryOverNextPaise", "declaredCashPaise", "expectedCashPaise", "openingFloatPaise", "toVaultPaise", "variancePaise", "vaultTopUpPaise"], dates: ["closedAt", "openedAt", "updatedAt"], cache: [] },
    "product_protection": { model: "ProductProtection", delegate: "productProtection", pk: ["id"], exact: [], dates: ["createdAt", "updatedAt"], cache: [] },
    "QuickNote": { model: "QuickNote", delegate: "quickNote", pk: ["id"], exact: [], dates: ["createdAt"], cache: [] },
    "redemption_holds": { model: "RedemptionHold", delegate: "redemptionHold", pk: ["id"], exact: ["amount"], dates: ["createdAt", "updatedAt"], cache: [] },
    "Role": { model: "Role", delegate: "role", pk: ["id"], exact: [], dates: [], cache: [] },
    "RolePermission": { model: "RolePermission", delegate: "rolePermission", pk: ["roleId", "permissionId"], exact: [], dates: [], cache: [] },
    "SavedFilter": { model: "SavedFilter", delegate: "savedFilter", pk: ["id"], exact: [], dates: ["createdAt", "updatedAt"], cache: [] },
    "ServiceCenter": { model: "ServiceCenter", delegate: "serviceCenter", pk: ["id"], exact: [], dates: ["createdAt"], cache: [] },
    "SocialConnection": { model: "SocialConnection", delegate: "socialConnection", pk: ["id"], exact: [], dates: ["createdAt", "respondedAt"], cache: [] },
    "staff_profiles": { model: "StaffProfile", delegate: "staffProfile", pk: ["userId"], exact: [], dates: ["createdAt", "joinedOn", "leftOn", "updatedAt"], cache: [] },
    "staff_salaries": { model: "StaffSalary", delegate: "staffSalary", pk: ["id"], exact: [], dates: ["createdAt", "effectiveFrom", "updatedAt"], cache: [] },
    "StatusTransition": { model: "StatusTransition", delegate: "statusTransition", pk: ["id"], exact: [], dates: [], cache: [] },
    "stock_reservations": { model: "StockReservation", delegate: "stockReservation", pk: ["id"], exact: [], dates: ["createdAt", "updatedAt"], cache: [] },
    "strategy_points": { model: "StrategyPoint", delegate: "strategyPoint", pk: ["id"], exact: ["points"], dates: ["updatedAt"], cache: [] },
    "TaskRecurrence": { model: "TaskRecurrence", delegate: "taskRecurrence", pk: ["id"], exact: [], dates: ["anchorAt", "createdAt", "endedAt", "updatedAt"], cache: [] },
    "Ticket": { model: "Ticket", delegate: "ticket", pk: ["id"], exact: [], dates: ["closedAt", "createdAt", "dueAt", "statusEnteredAt", "updatedAt", "wakeAt"], cache: [] },
    "TicketDeal": { model: "TicketDeal", delegate: "ticketDeal", pk: ["ticketId"], exact: [], dates: [], cache: [] },
    "TicketDelivery": { model: "TicketDelivery", delegate: "ticketDelivery", pk: ["ticketId"], exact: [], dates: [], cache: [] },
    "TicketHelp": { model: "TicketHelp", delegate: "ticketHelp", pk: ["ticketId"], exact: [], dates: [], cache: [] },
    "TicketLog": { model: "TicketLog", delegate: "ticketLog", pk: ["id"], exact: [], dates: ["createdAt", "doneAt", "dueAt"], cache: [] },
    "TicketOrder": { model: "TicketOrder", delegate: "ticketOrder", pk: ["ticketId"], exact: ["tierDiscountPct"], dates: ["deliveredAt", "packedAt", "paidAt", "refundedAt", "shippedAt"], cache: [] },
    "TicketOrderLine": { model: "TicketOrderLine", delegate: "ticketOrderLine", pk: ["id"], exact: [], dates: [], cache: [] },
    "TicketParticipant": { model: "TicketParticipant", delegate: "ticketParticipant", pk: ["id"], exact: [], dates: ["createdAt", "removedAt"], cache: [] },
    "TicketRefund": { model: "TicketRefund", delegate: "ticketRefund", pk: ["ticketId"], exact: [], dates: [], cache: [] },
    "TicketRepair": { model: "TicketRepair", delegate: "ticketRepair", pk: ["ticketId"], exact: [], dates: ["escalatedAt", "expectedReturn", "purchaseDate", "receivedBackAt"], cache: [] },
    "TicketStatus": { model: "TicketStatus", delegate: "ticketStatus", pk: ["id"], exact: [], dates: [], cache: [] },
    "TicketWorker": { model: "TicketWorker", delegate: "ticketWorker", pk: ["id"], exact: [], dates: [], cache: [] },
    "UniversalVoucher": { model: "UniversalVoucher", delegate: "universalVoucher", pk: ["id"], exact: [], dates: ["cancelledAt", "createdAt", "date", "deletedAt", "postedAt", "sourceCreatedAt", "updatedAt"], cache: [] },
    "User": { model: "User", delegate: "user", pk: ["id"], exact: [], dates: ["birthday", "createdAt", "tokensValidFrom", "updatedAt"], cache: [] },
    "user_counter_pins": { model: "UserCounterPin", delegate: "userCounterPin", pk: ["id"], exact: [], dates: ["createdAt", "lastLoginAt", "lastPasswordAt", "updatedAt"], cache: [], localAuthority: true },
    "UserPermission": { model: "UserPermission", delegate: "userPermission", pk: ["id"], exact: [], dates: ["createdAt", "expiresAt"], cache: [] },
    "UserPosition": { model: "UserPosition", delegate: "userPosition", pk: ["userId", "positionId"], exact: [], dates: ["createdAt"], cache: [] },
    "UserSurfaceSeen": { model: "UserSurfaceSeen", delegate: "userSurfaceSeen", pk: ["userId", "surface"], exact: [], dates: ["seenAt"], cache: [] },
    "VoucherAllocation": { model: "VoucherAllocation", delegate: "voucherAllocation", pk: ["id"], exact: ["amount"], dates: ["createdAt"], cache: [] },
    "VoucherDetail": { model: "VoucherDetail", delegate: "voucherDetail", pk: ["id"], exact: ["discountAmt", "discountPct", "roundOff", "shippingAmt", "shippingTaxAmt", "subtotal", "taxAmount", "totalAmount"], dates: ["createdAt", "refDate", "updatedAt"], cache: [] },
    "VoucherGlLine": { model: "VoucherGlLine", delegate: "voucherGlLine", pk: ["id"], exact: ["amount"], dates: [], cache: [] },
    "VoucherInventoryLine": { model: "VoucherInventoryLine", delegate: "voucherInventoryLine", pk: ["id"], exact: ["amount", "discountAmt", "discountPct", "freeQty", "quantity", "rate", "taxAmount", "taxRate"], dates: [], cache: [] },
    "VoucherLink": { model: "VoucherLink", delegate: "voucherLink", pk: ["id"], exact: [], dates: [], cache: [] },
    "VoucherPrintTemplate": { model: "VoucherPrintTemplate", delegate: "voucherPrintTemplate", pk: ["kind"], exact: [], dates: ["updatedAt"], cache: [] },
    "VoucherSeries": { model: "VoucherSeries", delegate: "voucherSeries", pk: ["kind"], exact: [], dates: ["updatedAt"], cache: [] },
    "VoucherSeriesCounter": { model: "VoucherSeriesCounter", delegate: "voucherSeriesCounter", pk: ["kind", "counterNumber"], exact: [], dates: ["updatedAt"], cache: [], localAuthority: true },
    "WallPost": { model: "WallPost", delegate: "wallPost", pk: ["id"], exact: [], dates: ["createdAt"], cache: [] },
    "WallPostComment": { model: "WallPostComment", delegate: "wallPostComment", pk: ["id"], exact: [], dates: ["createdAt"], cache: [] },
    "WallPostLike": { model: "WallPostLike", delegate: "wallPostLike", pk: ["id"], exact: [], dates: ["createdAt"], cache: [] },
    "Work": { model: "Work", delegate: "work", pk: ["id"], exact: [], dates: [], cache: [] },
    "WorkerTransition": { model: "WorkerTransition", delegate: "workerTransition", pk: ["id"], exact: [], dates: [], cache: [] },
    "WorkGroup": { model: "WorkGroup", delegate: "workGroup", pk: ["id"], exact: [], dates: ["createdAt"], cache: [] },
    "WorkGroupWork": { model: "WorkGroupWork", delegate: "workGroupWork", pk: ["workGroupId", "workId"], exact: [], dates: [], cache: [] },
};
