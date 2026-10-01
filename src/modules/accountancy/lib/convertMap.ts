// Generic voucher-conversion map — the single source of truth for which voucher
// kind may convert into which. Adding a conversion is a one-line data change;
// no engine code changes. Pure data (no prisma / no React), so both the client
// (the Day Book / register ⋮ menu, DayBookActionsMenu) and the server (convert
// API) import it.
//
// Conversion is accountancy-only: it creates a DRAFT of the target kind pre-filled
// from the source, linked back via refVoucherId. It never touches the pipeline.

export interface ConvertTarget {
    kind:  string;
    label: string;
}

export const CONVERT_MAP: Record<string, ConvertTarget[]> = {
    // Estimates → an order (commitment), a delivery challan, or straight to a sale
    // (invoice). POS estimates stay on the POS side, not the office chain.
    ESTIMATE:       [{ kind: "SALES_ORDER", label: "Sales Order" }, { kind: "CHALLAN", label: "Challan" }, { kind: "SALE", label: "Sale" }],
    POS_ESTIMATE:   [{ kind: "POS_ORDER", label: "POS Order" }, { kind: "POS", label: "POS Sale" }],
    // Office order → deliver goods (challan) or invoice (sale). Counter/online
    // orders (POS/ONLINE) go straight to their sale.
    SALES_ORDER:    [{ kind: "CHALLAN", label: "Challan" }, { kind: "SALE", label: "Sale" }],
    POS_ORDER:      [{ kind: "POS", label: "POS Sale" }],
    ONLINE_ORDER:   [{ kind: "SALE", label: "Sale" }],
    // Purchase order → the purchase bill, or a goods-received note.
    PURCHASE_ORDER: [{ kind: "PURCHASE", label: "Purchase" }, { kind: "GRN", label: "GRN" }],
};

/** Allowed conversion targets for a source kind (empty when not convertible). */
export function convertTargets(kind: string): ConvertTarget[] {
    return CONVERT_MAP[kind] ?? [];
}

/** Is `targetKind` a permitted conversion of `sourceKind`? */
export function canConvert(sourceKind: string, targetKind: string): boolean {
    return (CONVERT_MAP[sourceKind] ?? []).some((t) => t.kind === targetKind);
}
