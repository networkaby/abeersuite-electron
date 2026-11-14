/**
 * The priced-item shape returned by `GET /api/pricing-strategy/items` — one
 * product with its resolved cost, the additive-margin engine's computed price,
 * and the display fields the pricing screens and barcode labels render.
 *
 * Lives here rather than in the route that serves it because it is imported
 * across module boundaries — notably by `modules/inventory/lib/labelItems.ts`,
 * which is shared code and stays in the public (shop) build after
 * `scripts/strip-build.ts` removes the office API routes. A type
 * anchored in a stripped route file breaks that build; a type in a lib does not.
 */
export interface PricingItem {
    id:               number;
    sku:              string;
    name:             string;
    categoryId:       number | null;
    groupId:          number | null;
    brandId:          number | null;
    categoryName:     string | null;
    groupName:        string | null;
    brandName:        string | null;
    /** Current cached stock balance. null = stock not tracked (e.g. services). */
    stock:                number | null;
    /** Per-item cost method override. null = inherit from OrgDefaults.valuationMethod. */
    costMethod:           string | null;
    /** Resolved method actually used: product.costMethod ?? OrgDefaults.valuationMethod. */
    effectiveCostMethod:  string;
    /** Deprecated (PricingStrategy dropped) — always null. */
    strategyCostMethod:   string | null;
    marginPercent:    number | null;
    effectiveSalePricePaise: number | null;
    mrpPaise:         number | null;
    /** Stays in the interface as null for back-compat; STD_COST was dropped in PR 3. */
    stdCostPaise:     number | null;
    /** Last-inward rate (LAST_INWARD walk) for display only. PR 3 dropped the cache. */
    lastPurchasePaise: number | null;
    /** Cost resolved under the product's saved costMethod (null = no data). */
    resolvedCostPaise:    number | null;
    resolvedCostFallback: string | null;
    /** Per-unit additional cost (shipping/courier, GST-exclusive paise) from the
     *  Costing page allocation layer. Kept SEPARATE from resolvedCostPaise — the
     *  base cost stays pristine. 0 when nothing allocated. */
    additionalCostPaise:  number;
    /** Computed sell price (additive-margin engine) — already capped at MRP. */
    computedPricePaise:   number | null;
    /** Pre-cap value from the cost×margin formula. Same as computedPricePaise when no cap fired. */
    rawComputedPricePaise: number | null;
    /** True when MRP capped the formula. */
    cappedAtMrp:          boolean;
    /** Deprecated (PricingStrategy dropped) — always null. */
    strategyId:           number | null;
    /** Deprecated (PricingStrategy dropped) — always null. */
    strategyName:         string | null;
    /** The additive margin % applied (base + brand + category + group points). */
    appliedMarkupPct:     number;
    /** Deprecated (additive model has no flat add) — always 0. */
    appliedFlatPaise:     number;
    /** Deprecated (additive model has no rounding step) — always 0. */
    appliedRoundingPaise: number;
    /** Resolved GST rate % (0 when no tax set anywhere in the cascade). */
    gstRatePct:           number;
    /** Primary scannable barcode (first BARCODE InvProductCode). null = none set. */
    barcode:              string | null;
    /** Every scannable code on the product (barcode + EAN + UPC) — search only. */
    codes:                { kind: string; value: string }[];
    /** Days since the last SALE/POS. null = never sold. Only populated with ?withSaleAge=1. */
    daysSinceLastSale:    number | null;
    /** Saved human sale price (paise). null = not set. Source of the barcode. */
    savedSalePricePaise:  number | null;
    /** Hand-set barcode tag (paise). null = auto from saved price + MRP. Always wins. */
    barcodeManualPaise:   number | null;
    /** true = the saved barcode was typed by hand (violet); false = made from the bands. */
    barcodeIsManual:      boolean;
    /** Today's barcode gap (barcode − effective) as % of the gap when the barcode
     *  was saved. null = not measurable. Needs Attention flags it below X%. */
    barcodeGapPct:        number | null;
    /** Which source materializes the effective price: "STRATEGY" | "COMPUTED" | "SAVED". */
    effectiveSalePriceSource: string;
    /** ISO timestamp the BARCODE price was last saved (legacy column name), or null. Drives the label date code. */
    salePriceFrozenAt:    string | null;
    /** ISO time the Fixed Price was saved as "until next purchase"; null = not temporary. */
    tempPriceSetAt:       string | null;
    /** While temporary: the selling choice that comes back after the next purchase. */
    tempRestoreSource:    string | null;
    /** While temporary: the Fixed Price (paise) that comes back; null = none. */
    tempRestoreSalePaise: number | null;
}
