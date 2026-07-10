// Generic voucher-conversion map — the single source of truth for which voucher
// kind may convert into which. Adding a conversion is a one-line data change;
// no engine code changes. Pure data (no prisma / no React), so both the client
// (Orders & Estimates page, Convert button) and the server (convert API) import it.
//
// Conversion is accountancy-only: it creates a DRAFT of the target kind pre-filled
// from the source, linked back via refVoucherId. It never touches the pipeline.

export interface ConvertTarget {
    kind:  string;
    label: string;
}

export const CONVERT_MAP: Record<string, ConvertTarget[]> = {
    // Estimates → an order (commitment) or straight to a sale (invoice). POS
    // estimates stay on the POS side (POS order / POS sale), not the office chain.
    ESTIMATE:       [{ kind: "SALES_ORDER", label: "Sales Order" }, { kind: "SALE", label: "Sale" }],
    POS_ESTIMATE:   [{ kind: "POS_ORDER", label: "POS Order" }, { kind: "POS", label: "POS Sale" }],
    // Orders (counter / office / online) → the sale invoice.
    SALES_ORDER:    [{ kind: "SALE", label: "Sale" }],
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
