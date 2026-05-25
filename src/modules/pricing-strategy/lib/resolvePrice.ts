// Sell-price resolver for the pricing-strategy module.
//
// Picks the most specific PricingStrategy for a product, applies its margin
// to a resolved unit cost (from resolveCost.ts), and rounds. Resolution order:
//
//   BRAND → GROUP → CATEGORY → ORG       (most-specific scope wins)
//   priority DESC                         (tiebreaker within the same scope)
//   isActive = true                       (inactive rows ignored)
//
// The product's `marginPercent` (if not null) overrides the matched strategy's
// markupPercent at the top of the chain — useful for one-off items that need
// a hand-tuned margin without creating a new strategy row.

import type { PricingScope, PricingStrategy } from "@/generated/prisma/client";

export interface PricingProductShape {
    id: number;
    categoryId: number | null;
    groupId:    number | null;
    brandId:    number | null;
    /** Per-item override; null = use the matched strategy's markupPercent. */
    marginPercent: { toString(): string } | number | null;
}

export interface ResolvedPrice {
    productId:           number;
    /** Source PricingStrategy. null = no active strategy matched the chain. */
    strategy:            PricingStrategy | null;
    /** Final unit sell price in paise — already capped at MRP if applicable. */
    pricePaise:          number | null;
    /** Pre-cap price from cost+margin formula. Equals `pricePaise` when no cap fired. */
    rawPricePaise:       number | null;
    /** True when MRP was set AND the formula price would have exceeded it. */
    cappedAtMrp:         boolean;
    /** Effective markup applied — product override if set, else strategy. */
    appliedMarkupPct:    number;
    /** Flat amount added before percent markup, in paise. */
    appliedFlatPaise:    number;
    /** Rounding step in paise (0 = exact). */
    appliedRoundingPaise: number;
}

const SCOPE_RANK: Record<PricingScope, number> = {
    BRAND:    4,
    GROUP:    3,
    CATEGORY: 2,
    ORG:      1,
};

/**
 * Walks the candidate strategies and returns the most specific one whose
 * scope matches the product. ORG with `scopeId = null` is always a candidate
 * for every product (the fallback default).
 */
export function pickStrategy(
    product: PricingProductShape,
    strategies: PricingStrategy[],
): PricingStrategy | null {
    let best: PricingStrategy | null = null;
    for (const s of strategies) {
        if (!s.isActive) continue;
        if (!matchesScope(product, s)) continue;
        if (best === null || isMoreSpecific(s, best)) best = s;
    }
    return best;
}

function matchesScope(p: PricingProductShape, s: PricingStrategy): boolean {
    if (s.scope === "ORG")      return s.scopeId === null;
    if (s.scope === "BRAND")    return s.scopeId !== null && s.scopeId === p.brandId;
    if (s.scope === "GROUP")    return s.scopeId !== null && s.scopeId === p.groupId;
    if (s.scope === "CATEGORY") return s.scopeId !== null && s.scopeId === p.categoryId;
    return false;
}

function isMoreSpecific(a: PricingStrategy, b: PricingStrategy): boolean {
    const ra = SCOPE_RANK[a.scope];
    const rb = SCOPE_RANK[b.scope];
    if (ra !== rb) return ra > rb;
    return a.priority > b.priority;
}

/**
 * Apply a strategy to a cost. `costPaise == null` → null price.
 * Formula: round((cost + flat) × (1 + markup/100), roundingPaise).
 *
 * MRP cap: when `mrpPaise > 0`, the final price is clamped down to MRP
 * (Indian law forbids selling above MRP). The pre-cap value is still
 * returned in `rawPricePaise` so the UI can show "would have been ₹X".
 * `mrpPaise <= 0` or null is treated as "no MRP set" → no cap.
 */
export function applyStrategy(
    costPaise: number | null,
    productMarginOverride: number | null,
    strategy: PricingStrategy | null,
    mrpPaise: number | null = null,
): {
    pricePaise:           number | null;
    rawPricePaise:        number | null;
    cappedAtMrp:          boolean;
    appliedMarkupPct:     number;
    appliedFlatPaise:     number;
    appliedRoundingPaise: number;
} {
    if (costPaise == null) {
        return {
            pricePaise:           null,
            rawPricePaise:        null,
            cappedAtMrp:          false,
            appliedMarkupPct:     0,
            appliedFlatPaise:     0,
            appliedRoundingPaise: 0,
        };
    }
    let raw:      number;
    let markupPct: number;
    let flatPaise: number;
    let rounding:  number;

    if (strategy === null) {
        // No strategy ⇒ fall back to cost itself (no markup applied).
        raw       = costPaise;
        markupPct = 0;
        flatPaise = 0;
        rounding  = 0;
    } else {
        markupPct =
            productMarginOverride != null ? productMarginOverride : Number(strategy.markupPercent);
        flatPaise = strategy.markupFlatPaise;
        rounding  = strategy.roundingPaise;
        raw       = (costPaise + flatPaise) * (1 + markupPct / 100);
    }
    const rounded = rounding > 0 ? Math.round(raw / rounding) * rounding : Math.round(raw);

    const cap = mrpPaise != null && mrpPaise > 0 ? mrpPaise : null;
    const capped = cap != null && rounded > cap;
    return {
        pricePaise:           capped ? cap! : rounded,
        rawPricePaise:        rounded,
        cappedAtMrp:          capped,
        appliedMarkupPct:     markupPct,
        appliedFlatPaise:     flatPaise,
        appliedRoundingPaise: rounding,
    };
}

/**
 * One-shot: pick strategy + apply margin. Returns a fully-resolved record
 * including which strategy won, what markup applied, and the final price.
 * Pass `mrpPaise` to enforce the MRP cap.
 */
export function resolveSellPrice(
    product: PricingProductShape,
    strategies: PricingStrategy[],
    costPaise: number | null,
    mrpPaise: number | null = null,
): ResolvedPrice {
    const strategy = pickStrategy(product, strategies);
    const productMarginOverride =
        product.marginPercent != null ? Number(product.marginPercent) : null;
    const applied = applyStrategy(costPaise, productMarginOverride, strategy, mrpPaise);
    return {
        productId: product.id,
        strategy,
        ...applied,
    };
}
