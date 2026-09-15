// Canonical human label for a voucher `type` (both GL `Voucher` and trading
// `InvVoucher` kinds). Intended as the single source of truth — but it is not yet
// the only one. Several screens still build the word themselves and disagree with
// this map: `POS` reads "POS Sale" here, "POS" in the day-book register and "pos"
// in the outstandings panel. New code should import this; before assuming an
// existing screen already agrees with it, go and look.
//
// Separate on purpose: `PER_KIND[].title` in modules/accountancy/lib/
// tradingVoucherKinds.ts is the longer vocabulary for form headings, where GRN is
// "Goods Received Note". Print templates keep their own labels too.

export const VOUCHER_TYPE_LABELS: Record<string, string> = {
    // GL vouchers (Voucher.type)
    CONTRA: "Contra", PAYMENT: "Payment", RECEIPT: "Receipt",
    CREDIT_NOTE: "Credit Note", DEBIT_NOTE: "Debit Note", JOURNAL: "Journal",
    // Trading / inventory vouchers (InvVoucher.type)
    SALE: "Sale", PURCHASE: "Purchase", POS: "POS Sale",
    ONLINE_INVOICE: "Online Invoice", ONLINE_ORDER: "Online Order",
    ESTIMATE: "Estimate", POS_ESTIMATE: "POS Estimate",
    POS_ORDER: "POS Order", SALES_ORDER: "Sales Order", PURCHASE_ORDER: "Purchase Order",
    SALE_RETURN: "Sale Return", PURCHASE_RETURN: "Purchase Return",
    GRN: "GRN", CHALLAN: "Delivery Challan",
    REJECTION_IN: "Rejection In", REJECTION_OUT: "Rejection Out",
    MANUFACTURING_JOURNAL: "Manufacturing Journal", PHYSICAL_STOCK: "Physical Stock",
    BRANCH_TRANSFER: "Branch Transfer",
};

/** Readable label for a voucher type. Falls back to a de-underscored title for
 *  unknown types; returns null for a nullish input. */
export function voucherTypeLabel(type?: string | null): string | null {
    if (!type) return null;
    return VOUCHER_TYPE_LABELS[type] ?? type.replace(/_/g, " ");
}
