// Stock-value helpers — single source of truth for any code that needs to
// turn product master fields (stock, costPaise, openingStock, openingRate)
// into rupee-denominated values.
//
// Pairs with `src/modules/accountancy/lib/effectiveBalance.ts` for the GL
// side; see also `closingStock.ts` for the org-wide aggregate.

export type ProductOpeningInput = {
    openingStock?: number | null;
    openingRate?:  number | null;
};

export type ProductCacheFields = {
    /** InvProduct.stock (qty cache, Int) */
    stock: number;
    /** InvProduct.costPaise (cost basis, Int paise) — null when no rate is known */
    costPaise: number | null;
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
 * Derive the running-cache fields (`stock`, `costPaise`) from opening qty &
 * rate so reports light up immediately after the master is saved. Same rule
 * shared by every write path (POST / PATCH / opening PUT). Subsequent
 * Purchase / Sale vouchers move from this baseline.
 */
export function syncProductCacheFromOpening(
    o: ProductOpeningInput,
): ProductCacheFields {
    return {
        stock:     o.openingStock != null ? Math.round(o.openingStock) : 0,
        costPaise: o.openingRate  != null ? Math.round(o.openingRate * 100) : null,
    };
}

export type ProductClosingInput = {
    stock:     number | null;
    costPaise: number | null;
};

/**
 * Per-product live closing value in rupees = stock × costPaise / 100. Returns
 * 0 when either field is missing or when stock is non-positive.
 */
export function productClosingValue(p: ProductClosingInput): number {
    if (p.stock == null || p.costPaise == null) return 0;
    if (p.stock <= 0) return 0;
    return (p.stock * p.costPaise) / 100;
}
