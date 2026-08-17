/**
 * Voucher-kind groupings shared by the Day Book's filter UI and the server that
 * answers it.
 *
 * These used to live inside the Day Book page, which was fine while the page held
 * every voucher in memory and filtered them itself. Now the server does the
 * filtering, so both halves have to agree on what "Optional only" means — and a
 * copy on each side is exactly how they drift. (They already did once: POS
 * estimate/order sat in neither set, so "Optional only" wrongly hid them.)
 */

/** Documentary / "optional" — quotes and commitments that post no money or stock. */
export const OPTIONAL_KINDS = new Set([
    "ESTIMATE", "POS_ESTIMATE", "POS_ORDER", "ONLINE_ORDER",
    "SALES_ORDER", "PURCHASE_ORDER", "CHALLAN",
]);

/** Inventory-ops — stock movement with no direct GL post. */
export const INVENTORY_KINDS = new Set([
    "GRN", "REJECTION_IN", "REJECTION_OUT",
    "MANUFACTURING_JOURNAL", "PHYSICAL_STOCK", "BRANCH_TRANSFER",
]);

/** Union — every non-regular row gets the muted/italic documentary styling. */
export const NON_REGULAR_KINDS = new Set([...OPTIONAL_KINDS, ...INVENTORY_KINDS]);

/** The "All Sale" / "All Purchase" / "All Payment" roll-ups in the kind dropdown. */
const KIND_GROUPS: Record<string, string[]> = {
    __sale_all__: ["SALE", "POS", "ONLINE_INVOICE", "SALE_RETURN"],
    __buy_all__:  ["PURCHASE", "PURCHASE_RETURN"],
    __pay_all__:  ["PAYMENT", "RECEIPT", "CONTRA", "CREDIT_NOTE", "DEBIT_NOTE"],
};

/**
 * Kind filter → the concrete spine `type` values it admits.
 * `null` means "no type constraint" (the __all__ case).
 */
export function kindsForFilter(filter: string | null | undefined): string[] | null {
    if (!filter || filter === "__all__") return null;
    return KIND_GROUPS[filter] ?? [filter];
}

/** Category quick-filter → the kinds it admits, or `null` for no constraint. */
export function kindsForCategory(category: string | null | undefined): string[] | null {
    if (category === "optional")  return [...OPTIONAL_KINDS];
    if (category === "inventory") return [...INVENTORY_KINDS];
    return null;
}
