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

/** Every policy key, derived from the defaults so the two can never drift. */
export const OFFLINE_POLICY_KEYS = Object.keys(DEFAULT_OFFLINE_POLICIES) as (keyof OfflinePolicies)[];

/**
 * Turns whatever is stored in `OfflinePolicy.policies` into a complete, typed set.
 *
 * The stored row is deliberately partial and deliberately untrusted: it may predate
 * a toggle this build knows about, and it may carry a key from a NEWER build that
 * this counter has never heard of. So take only known boolean keys and let
 * `DEFAULT_OFFLINE_POLICIES` fill the rest — a missing key means "whatever this build
 * considers safe", never `false`, because silently refusing a sale is worse than the
 * risk the toggle was guarding.
 */
export function mergeOfflinePolicies(stored: unknown): OfflinePolicies {
    const merged = { ...DEFAULT_OFFLINE_POLICIES };
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        const raw = stored as Record<string, unknown>;
        for (const key of OFFLINE_POLICY_KEYS) {
            if (typeof raw[key] === "boolean") merged[key] = raw[key] as boolean;
        }
    }
    return merged;
}

/**
 * Validates whether a given voucher type or ticket action is permitted offline.
 *
 * `policies` is required — there is no ambient source to fall back on. The old
 * fallback read localStorage, which on the server is simply absent, so every server
 * check silently used the hard-coded defaults and the admin's toggles did nothing.
 */
export function isVoucherTypeSafeOffline(voucherType: string, policies: OfflinePolicies): boolean {
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

/** The four master-data families the policy page offers a create/edit pair for. */
export type MasterEntity = "product" | "account" | "taxonomy" | "customer";

/**
 * Validates Master Data operation offline.
 */
export function isMasterOperationAllowedOffline(
    entity: MasterEntity,
    operation: "create" | "edit",
    policies: OfflinePolicies,
): boolean {
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

/** Plain-language name for a master family, for the refusal message. */
const MASTER_ENTITY_LABEL: Record<MasterEntity, string> = {
    product:  "products",
    account:  "ledger accounts",
    taxonomy: "brands, categories and units",
    customer: "customer profiles",
};

/** Why a master-data write was refused, in words a cashier can act on. */
export function getOfflineMasterBlockedReason(entity: MasterEntity, operation: "create" | "edit"): string {
    const verb = operation === "create" ? "Creating" : "Editing";
    return `${verb} ${MASTER_ENTITY_LABEL[entity]} is switched off while this counter is offline `
        + "(Settings → Offline Policies). Do it from an office machine, or ask an admin to allow it.";
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
