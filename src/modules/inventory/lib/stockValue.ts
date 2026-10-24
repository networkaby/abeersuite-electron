// Stock-value helpers.
//
// PR 3 of noble-boole removed `InvProduct.costPaise` — the cached "last
// inward rate" column. Per-product closing value now comes from the ledger
// walk in `valuation.ts#valueStockBatch` instead of a `stock × costPaise`
// snapshot. The opening-value helper stays as-is (opening master fields are
// still load-bearing).
//
// Pairs with `aggregateClosingAsOf` in `aggregateLedger.ts` for the GL
// side; see also `closingStock.ts` for the org-wide aggregate.

export type ProductOpeningInput = {
    openingStock?: number | null;
    openingRate?:  number | null;
};

/**
 * Per-product opening value = qty × rate. Returns null when either field is
 * missing — used to write `InvProduct.openingValue` on master save.
 */
export function productOpeningValue(o: ProductOpeningInput): number | null {
    if (o.openingStock == null || o.openingRate == null) return null;
    return o.openingStock * o.openingRate;
}

/**
 * The saved stock total for a product being CREATED: just its opening, because a
 * new product has no movement yet. Spread into a Prisma create.
 *
 * Never use it on an existing product — an edit to the opening must keep the
 * movements (opening 10, +50, −30 = 30; opening → 12 reads 32, not 12). Write the
 * opening, then `recomputeProductStock` in the same transaction.
 */
export function syncProductCacheFromOpening(
    o: ProductOpeningInput,
): { stock: number } {
    return { stock: o.openingStock != null ? Math.round(o.openingStock) : 0 };
}
