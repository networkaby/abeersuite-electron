/**
 * Offline Voucher & Master Data Safety Policy
 *
 * Defines granular offline creation & editing permissions for every voucher, ticket,
 * and master entity (Products, Accounts, Taxonomy, Customers) across AbeerSuite.
 */

export interface OfflinePolicies {
    // 1. Point of Sale (POS)
    allowPosSale: boolean;
    allowPosEstimate: boolean;
    allowPosOrder: boolean;
    allowPosReturn: boolean;
    allowPosShift: boolean;

    // 2. Financial Vouchers (GL)
    allowReceipt: boolean;
    allowPayment: boolean;
    allowContra: boolean;
    allowJournal: boolean;
    allowCreditNote: boolean;
    allowDebitNote: boolean;

    // 3. Trading Vouchers (GL + Stock)
    allowSale: boolean;
    allowPurchase: boolean;
    allowSaleReturn: boolean;
    allowPurchaseReturn: boolean;

    // 4. Inventory Operations (Stock Only)
    allowGrn: boolean;
    allowChallan: boolean;
    allowPhysicalStock: boolean;
    allowBranchTransfer: boolean;
    allowManufacturingJournal: boolean;
    allowRejectionIn: boolean;
    allowRejectionOut: boolean;

    // 5. Optional Documents (Quotes & Orders)
    allowEstimate: boolean;
    allowSalesOrder: boolean;
    allowPurchaseOrder: boolean;

    // 6. Workflow, Tickets & CRM
    allowRepairTicket: boolean;
    allowHelpTicket: boolean;
    allowCrmDeal: boolean;
    allowTask: boolean;
    allowTimelineLog: boolean;

    // 7. Master Data — Products, Accounts, Taxonomy & Customers (Create vs Edit Toggles)
    allowProductCreate: boolean;          // Add new products & barcodes
    allowProductEdit: boolean;            // Edit product names & prices
    allowAccountCreate: boolean;          // Create new ledger accounts
    allowAccountEdit: boolean;            // Edit ledger accounts
    allowMasterTaxonomyCreate: boolean;   // Create Brands, Categories, Units
    allowMasterTaxonomyEdit: boolean;     // Edit Brands, Categories, Units
    allowCustomerCreate: boolean;         // Add walk-in customers
    allowCustomerEdit: boolean;           // Edit customer profiles
}

export const DEFAULT_OFFLINE_POLICIES: OfflinePolicies = {
    // POS (Default: All Safe Enabled)
    allowPosSale: true,
    allowPosEstimate: true,
    allowPosOrder: true,
    allowPosReturn: true,
    allowPosShift: true,

    // Financial (Inward Receipt Safe; Outward Guarded)
    allowReceipt: true,
    allowPayment: false,
    allowContra: false,
    allowJournal: false,
    allowCreditNote: false,
    allowDebitNote: false,

    // Trading (Counter Sales & Returns Safe; Purchases Guarded)
    allowSale: true,
    allowPurchase: false,
    allowSaleReturn: true,
    allowPurchaseReturn: false,

    // Inventory (Inward/Challan Safe; Global Stock Reconcile Guarded)
    allowGrn: false,
    allowChallan: true,
    allowPhysicalStock: false,
    allowBranchTransfer: false,
    allowManufacturingJournal: false,
    allowRejectionIn: true,
    allowRejectionOut: false,

    // Optional (All Safe to Quote)
    allowEstimate: true,
    allowSalesOrder: true,
    allowPurchaseOrder: false,

    // Workflow & Tickets (All Safe for Front-Desk Intake)
    allowRepairTicket: true,
    allowHelpTicket: true,
    allowCrmDeal: true,
    allowTask: true,
    allowTimelineLog: true,

    // Master Data (Default: All Enabled for Smooth Operation)
    allowProductCreate: true,
    allowProductEdit: true,
    allowAccountCreate: true,
    allowAccountEdit: true,
    allowMasterTaxonomyCreate: true,
    allowMasterTaxonomyEdit: true,
    allowCustomerCreate: true,
    allowCustomerEdit: true,
};

const STORAGE_KEY = "abeersuite_offline_policies";

/**
 * Returns current active offline policies.
 */
export function getOfflinePolicies(): OfflinePolicies {
    if (typeof window !== "undefined") {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                return { ...DEFAULT_OFFLINE_POLICIES, ...JSON.parse(raw) };
            }
        } catch {
            // Fallback to defaults
        }
    }
    return DEFAULT_OFFLINE_POLICIES;
}

/**
 * Saves updated offline policies.
 */
export function saveOfflinePolicies(policies: OfflinePolicies): void {
    if (typeof window !== "undefined") {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(policies));
        } catch (err) {
            console.error("[OfflinePolicies] Failed to save:", err);
        }
    }
}

/**
 * Validates whether a given voucher type or ticket action is permitted offline.
 */
export function isVoucherTypeSafeOffline(voucherType: string, customPolicies?: OfflinePolicies): boolean {
    const policies = customPolicies || getOfflinePolicies();
    const normalized = voucherType.toUpperCase().replace(/-/g, "_");

    switch (normalized) {
        // POS
        case "POS":
            return policies.allowPosSale;
        case "POS_ESTIMATE":
            return policies.allowPosEstimate;
        case "POS_ORDER":
            return policies.allowPosOrder;
        case "POS_RETURN":
            return policies.allowPosReturn;
        case "POS_SHIFT":
        case "POSSHIFT":
            return policies.allowPosShift;

        // Financial (GL)
        case "RECEIPT":
            return policies.allowReceipt;
        case "PAYMENT":
            return policies.allowPayment;
        case "CONTRA":
            return policies.allowContra;
        case "JOURNAL":
            return policies.allowJournal;
        case "CREDIT_NOTE":
            return policies.allowCreditNote;
        case "DEBIT_NOTE":
            return policies.allowDebitNote;

        // Trading
        case "SALE":
            return policies.allowSale;
        case "PURCHASE":
            return policies.allowPurchase;
        case "SALE_RETURN":
            return policies.allowSaleReturn;
        case "PURCHASE_RETURN":
            return policies.allowPurchaseReturn;

        // Inventory
        case "GRN":
            return policies.allowGrn;
        case "CHALLAN":
            return policies.allowChallan;
        case "PHYSICAL_STOCK":
            return policies.allowPhysicalStock;
        case "BRANCH_TRANSFER":
            return policies.allowBranchTransfer;
        case "MANUFACTURING_JOURNAL":
            return policies.allowManufacturingJournal;
        case "REJECTION_IN":
            return policies.allowRejectionIn;
        case "REJECTION_OUT":
            return policies.allowRejectionOut;

        // Optional
        case "ESTIMATE":
            return policies.allowEstimate;
        case "SALES_ORDER":
            return policies.allowSalesOrder;
        case "PURCHASE_ORDER":
            return policies.allowPurchaseOrder;

        // Tickets & Workflow
        case "REPAIR_TICKET":
        case "REPAIR":
            return policies.allowRepairTicket;
        case "HELP_TICKET":
        case "HELP":
            return policies.allowHelpTicket;
        case "CRM_DEAL":
        case "DEAL":
            return policies.allowCrmDeal;
        case "TASK":
            return policies.allowTask;
        case "TIMELINE_LOG":
        case "TICKET_LOG":
            return policies.allowTimelineLog;

        default:
            return false;
    }
}

/**
 * Validates Master Data operation offline.
 */
export function isMasterOperationAllowedOffline(
    entity: "product" | "account" | "taxonomy" | "customer",
    operation: "create" | "edit",
    customPolicies?: OfflinePolicies
): boolean {
    const policies = customPolicies || getOfflinePolicies();
    if (entity === "product") {
        return operation === "create" ? policies.allowProductCreate : policies.allowProductEdit;
    }
    if (entity === "account") {
        return operation === "create" ? policies.allowAccountCreate : policies.allowAccountEdit;
    }
    if (entity === "taxonomy") {
        return operation === "create" ? policies.allowMasterTaxonomyCreate : policies.allowMasterTaxonomyEdit;
    }
    if (entity === "customer") {
        return operation === "create" ? policies.allowCustomerCreate : policies.allowCustomerEdit;
    }
    return true;
}

/**
 * Returns a user-friendly explanation when an entity is disabled offline.
 */
export function getOfflineVoucherBlockedReason(voucherType: string): string {
    const normalized = voucherType.toUpperCase().replace(/-/g, "_");
    if (normalized === "PAYMENT") {
        return "Payment vouchers are disabled while offline to prevent double-spending from cash/bank accounts across multiple counters. You can enable this in Settings > Offline Policies.";
    }
    if (normalized === "CONTRA") {
        return "Contra fund transfers between accounts are disabled while offline to prevent balance desync across counters.";
    }
    if (normalized === "PURCHASE") {
        return "Purchase bill entries require an online connection to verify supplier accounts and GST credentials.";
    }
    if (normalized === "PHYSICAL_STOCK" || normalized === "BRANCH_TRANSFER") {
        return "Inventory reconciliation and branch transfers are disabled while offline to prevent stock drift across branches.";
    }
    return `The action "${voucherType}" is currently disabled in Settings > Offline Policies.`;
}
