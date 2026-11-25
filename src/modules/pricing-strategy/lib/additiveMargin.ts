// The single pricing engine: additive-margin "strategy points".
//
// A product's margin% is the SUM of the points for the dimensions it falls under:
//   margin% = base + brand[brandId] + category[categoryId] + group[groupId] + product[id]
// (a missing point row contributes 0). The per-product point is an additive
// override — a single SKU can be pulled down (negative) or pushed up (positive)
// while still riding any future brand/category/group changes. The sell price is a markup on cost,
// GST-inclusive, MRP-capped — IDENTICAL to the /office/pricing-strategy/strategies
// preview, so the preview and what actually sells always agree:
//   cost_incl = round(cost × (1 + gst/100))
//   price     = round(cost_incl × (1 + margin/100))   then clamped to MRP
//
// Band dimensions (STOCK_BAND / AGE_BAND / MOVE_BAND) exist in the schema but are
// reserved — they contribute 0 until a banding feature is built.
//
// Replaces the dropped PricingStrategy engine (pickStrategy + applyStrategy).

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { sumGroupPointsWithAncestors } from "./groupPointsHierarchy";

/** Grouped points — same shape the points GET/PUT API uses. */
export interface StrategyPointsResolved {
    base: number;
    brand: Record<string, number>;
    category: Record<string, number>;
    group: Record<string, number>;
    product: Record<string, number>;
    /** InvProductGroup id → parentId, for cascading GROUP points up the tree. */
    groupParentById: Record<string, number | null>;
}

/** Load the single org-wide additive-margin point set, grouped by dimension. */
export async function loadStrategyPoints(db: typeof prisma = prisma): Promise<StrategyPointsResolved> {
    const [rows, groups] = await Promise.all([
        db.strategyPoint.findMany(),
        db.invProductGroup.findMany({ select: { id: true, parentId: true } }),
    ]);
    const out: StrategyPointsResolved = {
        base: 0, brand: {}, category: {}, group: {}, product: {},
        groupParentById: Object.fromEntries(groups.map((g) => [String(g.id), g.parentId])),
    };
    for (const r of rows) {
        const v = Number(r.points);
        switch (r.dimension) {
            case "BASE":     out.base = v; break;
            case "BRAND":    out.brand[r.refKey] = v; break;
            case "CATEGORY": out.category[r.refKey] = v; break;
            case "GROUP":    out.group[r.refKey] = v; break;
            case "PRODUCT":  out.product[r.refKey] = v; break;
            // STOCK_BAND / AGE_BAND / MOVE_BAND — reserved, contribute 0 for now.
            default: break;
        }
    }
    return out;
}

/**
 * Sum the points that apply to a product: base + its brand + category +
 * group (own group's points PLUS every ancestor group's, see
 * groupPointsHierarchy.ts) + per-product.
 */
export function additiveMarginPct(
    p: { id?: number; brandId: number | null; categoryId: number | null; groupId: number | null },
    points: StrategyPointsResolved,
): number {
    let m = points.base;
    if (p.brandId    != null) m += points.brand[String(p.brandId)]       ?? 0;
    if (p.categoryId != null) m += points.category[String(p.categoryId)] ?? 0;
    if (p.groupId    != null) m += sumGroupPointsWithAncestors(p.groupId, points.group, points.groupParentById);
    if (p.id         != null) m += points.product[String(p.id)]          ?? 0;
    return m;
}

/**
 * Markup-on-cost sell price (GST-inclusive, MRP-capped). `costPaise` is the
 * GST-EXCLUSIVE resolved cost. Mirrors the /strategies preview's two-step
 * rounding so preview === live. `costPaise == null` → null price.
 */
export function additivePrice(
    costPaise: number | null,
    marginPct: number,
    mrpPaise: number | null = null,
    gstRatePct: number = 0,
): { pricePaise: number | null; rawPricePaise: number | null; cappedAtMrp: boolean } {
    if (costPaise == null) return { pricePaise: null, rawPricePaise: null, cappedAtMrp: false };
    const costIncl = Math.round(costPaise * (1 + gstRatePct / 100));
    const raw      = Math.round(costIncl * (1 + marginPct / 100));
    const cap      = mrpPaise != null && mrpPaise > 0 ? mrpPaise : null;
    const capped   = cap != null && raw > cap;
    return { pricePaise: capped ? cap! : raw, rawPricePaise: raw, cappedAtMrp: capped };
}

/**
 * Reverse of `additivePriceWithSurcharge`: the margin % (2 dp, the column's
 * scale) that turns this cost into `pricePaise`. Null when there is no usable
 * cost. Used to give a Computed product its first margin from the sell price
 * typed when it was created.
 */
export function marginForPrice(
    baseCostPaise: number | null,
    additionalCostPaise: number,
    pricePaise: number,
    gstRatePct: number = 0,
): number | null {
    if (baseCostPaise == null) return null;
    const costIncl = Math.round((baseCostPaise + additionalCostPaise) * (1 + gstRatePct / 100));
    if (costIncl <= 0) return null;
    const pct = Math.round((pricePaise / costIncl - 1) * 10000) / 100;
    return Math.min(9999.99, Math.max(-99.99, pct)); // Decimal(6,2)
}

/**
 * `additivePrice` with the pricing-strategy "additional cost" surcharge folded in.
 * The surcharge (shipping/courier, GST-EXCLUSIVE paise) is added to the base cost
 * BEFORE the GST gross-up — this is the ONE documented home for that rule. The
 * base resolved cost is never mutated; callers pass it and the surcharge separately.
 */
export function additivePriceWithSurcharge(
    baseCostPaise: number | null,
    additionalCostPaise: number,
    marginPct: number,
    mrpPaise: number | null = null,
    gstRatePct: number = 0,
): { pricePaise: number | null; rawPricePaise: number | null; cappedAtMrp: boolean } {
    const effective = baseCostPaise == null ? null : baseCostPaise + additionalCostPaise;
    return additivePrice(effective, marginPct, mrpPaise, gstRatePct);
}
