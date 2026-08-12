/**
 * Reorder-point math — the complete formula (deliberately NOT Tally's, which
 * conflates the sampling window and the coverage horizon into one "Period"):
 *
 *   avgDailyUsage = Σ outQty over the last REORDER_USAGE_WINDOW_DAYS ÷ window
 *   reorderLevel  = avgDailyUsage × leadTimeDays          (coverage horizon)
 *   threshold     = max(reorderLevel, lowStockThreshold)  (manual floor)
 *   isLow         = threshold > 0 && available (stock − reserved) <= threshold
 *   shortfall     = max(threshold − available, 0)        what the SHELF needs
 *   orderQty      = shortfall lifted to minOrderQty, then rounded UP to a whole
 *                   orderPackQty                         what the SUPPLIER sells
 *
 * Lean by design: the 30-day trailing average follows a dying trend DOWN, so
 * the system naturally stops flagging cooling products — dead-stock protection.
 * The manual floor covers new / no-history items.
 *
 * The `threshold > 0` guard is load-bearing, not defensive tidiness. An item
 * with no sale history and no manual floor yields `0 × leadTime = 0`, and that
 * zero is the ABSENCE of a demand estimate, not an estimate that demand is
 * zero. Without the guard, `available <= threshold` reads 0 <= 0 and fires a
 * buy signal carrying shortfall 0 — an order for nothing. No reorder point, no
 * opinion; the item earns one when a human sets the floor or when sales
 * accumulate and movementClass.ts promotes it NEW → SLOW → REGULAR.
 */

// Average-daily-usage + movement classification live in movementClass.ts —
// the class decides the sampling window (Regular = slow band, Slow = the
// longer non-moving band) and guards against dead-stock blips.

/** reorderLevel = avgDailyUsage × leadTimeDays, floored by the manual threshold. */
export function reorderThreshold(avgDailyUsage: number, leadTimeDays: number, lowStockThreshold: number): number {
    return Math.max(avgDailyUsage * leadTimeDays, lowStockThreshold);
}

// ── Orderable quantity: MOQ + pack rounding ──────────────────────────────────
//
// WHY THIS EXISTS: `shortfall` is what the shelf needs — 45 pieces. It is NOT
// what the supplier will sell. He sells a packet of 100 and refuses orders
// below 200. So the shortfall is an un-placeable number; the buyer had to do
// this arithmetic in his head on every line, and got it wrong on the ones that
// matter (the cheap fast movers where a pack is trivial, the expensive slow
// ones where a pack is a month of cash).
//
// Two supplier terms, deliberately kept as two fields because they behave
// differently and shops have one, the other, or both:
//
//   minOrderQty   a FLOOR. "Nothing below 200." Above it, any quantity.
//   orderPackQty  a MULTIPLE / STEP. "Only in packets of 100." 150 is invalid.
//
// Order of operations matters — MOQ first, THEN pack:
//
//   qty = max(shortfall, minOrderQty)          lift to the supplier's floor
//   qty = ceil(qty / orderPackQty) × orderPackQty   step up to a whole pack
//
// Doing it the other way round can land BELOW the MOQ (shortfall 45, pack 100,
// MOQ 250 → pack-first gives 100, which he rejects). MOQ-first gives 250 → 300.
// Rounding is always UP, never down: rounding down means you knowingly stay
// short, which defeats the whole reorder point.
//
// The result is DECISION SUPPORT, not an instruction. When the shortfall is 5
// and the pack is 100, the report still shows 100 — deliberately, so the buyer
// SEES that covering a 5-piece gap costs a 100-piece commitment and can decide
// to skip it. Hiding the line would hide the money. (Cost is truth: the pack
// multiple is a cash decision, so it is stated, never auto-resolved.)
//
// Quantities are whole units project-wide, so the output is always an integer.
export function suggestedOrderQty(
    shortfall: number,
    orderPackQty: number | null,
    minOrderQty: number | null,
): number {
    if (shortfall <= 0) return 0;
    const moq = minOrderQty && minOrderQty > 0 ? minOrderQty : 0;
    const pack = orderPackQty && orderPackQty > 0 ? orderPackQty : 0;
    const lifted = Math.max(shortfall, moq);
    if (!pack) return Math.ceil(lifted);
    return Math.ceil(lifted / pack) * pack;
}

// ── Smart Reorder: substitute bands ──────────────────────────────────────────
//
// Items in the same LEAF product group whose last-inward COST sits within x%
// of each other are treated as substitutes (Enter UPS ≈ Frontech UPS): their
// demand is pooled so the shop reorders the BAND, not each brand separately —
// killing the double-order overstock. Cost (not sale price) is the banding
// basis: sale price is manipulated by our own margins/overrides, while cost is
// the market's quality-tier signal. Sale price/margin is shown per member as
// the "which brand to procure" decision support instead.

export interface BandableItem {
    id: number;
    groupId: number | null;
    groupName: string | null;
    /** Last-inward unit cost in paise; null = no purchase history → can't band. */
    costPaise: number | null;
}

export interface CostBand {
    key: string;
    /** null for solo pseudo-bands (ungrouped / uncosted items). */
    groupName: string | null;
    costMinPaise: number | null;
    costMaxPaise: number | null;
    productIds: number[];
}

/**
 * Cluster items into cost bands within each leaf group. Sorted by cost; an
 * item joins the current band while cost ≤ band's CHEAPEST member × (1 + x%)
 * — anchoring to the cheapest stops chain-drift (₹100→₹118→₹139→… stretching
 * one band forever). Ungrouped / uncosted items come back as single-member
 * pseudo-bands so the caller renders one uniform list.
 */
export function clusterCostBands(items: BandableItem[], tolerancePct: number): CostBand[] {
    const tol = Math.min(Math.max(tolerancePct, 0), 100) / 100;
    const bands: CostBand[] = [];

    const bandable = items.filter((i) => i.groupId != null && i.costPaise != null);
    const solo = items.filter((i) => i.groupId == null || i.costPaise == null);

    const byGroup = new Map<number, BandableItem[]>();
    for (const it of bandable) {
        const list = byGroup.get(it.groupId!) ?? [];
        list.push(it);
        byGroup.set(it.groupId!, list);
    }

    for (const [groupId, members] of byGroup) {
        members.sort((a, b) => a.costPaise! - b.costPaise!);
        let current: BandableItem[] = [];
        const flush = () => {
            if (current.length === 0) return;
            bands.push({
                key: `g${groupId}-${current[0].id}`,
                groupName: current[0].groupName,
                costMinPaise: current[0].costPaise!,
                costMaxPaise: current[current.length - 1].costPaise!,
                productIds: current.map((m) => m.id),
            });
            current = [];
        };
        for (const m of members) {
            if (current.length > 0 && m.costPaise! > current[0].costPaise! * (1 + tol)) flush();
            current.push(m);
        }
        flush();
    }

    for (const s of solo) {
        bands.push({ key: `solo-${s.id}`, groupName: s.groupName, costMinPaise: s.costPaise, costMaxPaise: s.costPaise, productIds: [s.id] });
    }

    return bands;
}
