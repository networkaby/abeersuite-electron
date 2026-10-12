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

import { valueStockBatch, type ValuationMethod } from "@/modules/inventory/lib/valuation";

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
 * Derive the running qty cache from opening qty. Returns a partial
 * InvProduct shape ready to spread into a Prisma update. PR 3 reduced this
 * to a single field (stock) — costPaise is no longer cached. The opening
 * rate still seeds cost via the synthetic first lot in loadInwardLots.
 */
export function syncProductCacheFromOpening(
    o: ProductOpeningInput,
): { stock: number } {
    return { stock: o.openingStock != null ? Math.round(o.openingStock) : 0 };
}

/**
 * Per-product live closing value in rupees. Walks the ledger via
 * `valueStockBatch` for the chosen method. Defaults to LAST_INWARD so
 * single-product callers that don't care about method match the BS at its
 * legacy default. Heavy callers should batch via `valueStockBatch` directly.
 */
export async function productClosingValue(
    productId: number,
    stock: number | null,
    method: ValuationMethod = "LAST_INWARD",
): Promise<number> {
    if (stock == null || stock <= 0) return 0;
    const m = await valueStockBatch([{ id: productId, stock }], method);
    return m.get(productId)?.value ?? 0;
}
