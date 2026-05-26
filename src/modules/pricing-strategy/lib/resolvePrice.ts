// Sell-price formula: turn (cost, margin, strategy, mrp) into a price.
//
// Strategy *selection* lives in `matchStrategy.ts` (multi-condition matcher).
// This file only owns the application of the formula once a strategy has
// been picked. The product's `marginPercent` (if not null) overrides the
// matched strategy's markupPercent at the top of the chain.

import type { PricingStrategy } from "@/generated/prisma/client";

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

