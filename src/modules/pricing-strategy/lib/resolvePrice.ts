// Sell-price formula: turn (cost, margin, strategy, mrp) into a price.
//
// Strategy *selection* lives in `matchStrategy.ts` (multi-condition matcher).
// This file only owns the application of the formula once a strategy has
// been picked. The product's `marginPercent` (if not null) overrides the
// matched strategy's markupPercent at the top of the chain.

import type { PricingStrategy } from "@/generated/prisma/client";

/**
 * Apply a strategy to a cost. `costPaise == null` → null price.
 * Formula: round((cost + flat) × (1 + markup/100) × (1 + gst/100), roundingPaise).
 *
 * `pricePaise` is the consumer-facing **GST-inclusive** price. The GST step
 * runs after the markup so the rounding applied at the end is meaningful for
 * print/labels. `gstRatePct = 0` (default) leaves the value exclusive — only
 * relevant for legacy callers that don't yet resolve tax.
 *
 * MRP cap: when `mrpPaise > 0`, the final price is clamped down to MRP
 * (Indian law forbids selling above MRP — MRP is already inclusive, so the
 * comparison is apples-to-apples after the GST multiplier). The pre-cap
 * value is still returned in `rawPricePaise` so the UI can show "would have
 * been ₹X". `mrpPaise <= 0` or null is treated as "no MRP set" → no cap.
 */
export function applyStrategy(
    costPaise: number | null,
    productMarginOverride: number | null,
    strategy: PricingStrategy | null,
    mrpPaise: number | null = null,
    gstRatePct: number = 0,
): {
    pricePaise:           number | null;
    rawPricePaise:        number | null;
    cappedAtMrp:          boolean;
    appliedMarkupPct:     number;
    appliedFlatPaise:     number;
    appliedRoundingPaise: number;
    appliedGstRatePct:    number;
} {
    if (costPaise == null) {
        return {
            pricePaise:           null,
            rawPricePaise:        null,
            cappedAtMrp:          false,
            appliedMarkupPct:     0,
            appliedFlatPaise:     0,
            appliedRoundingPaise: 0,
            appliedGstRatePct:    0,
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
    const gross   = raw * (1 + gstRatePct / 100);
    const rounded = rounding > 0 ? Math.round(gross / rounding) * rounding : Math.round(gross);

    const cap = mrpPaise != null && mrpPaise > 0 ? mrpPaise : null;
    const capped = cap != null && rounded > cap;
    return {
        pricePaise:           capped ? cap! : rounded,
        rawPricePaise:        rounded,
        cappedAtMrp:          capped,
        appliedMarkupPct:     markupPct,
        appliedFlatPaise:     flatPaise,
        appliedRoundingPaise: rounding,
        appliedGstRatePct:    gstRatePct,
    };
}

