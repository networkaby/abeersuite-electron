import { prisma } from "@/shared/lib/prisma/prismaClient";
import { toNumber } from "@/modules/accountancy/lib/balance";

/**
 * Reorder-point math — the complete formula (deliberately NOT Tally's, which
 * conflates the sampling window and the coverage horizon into one "Period"):
 *
 *   avgDailyUsage = Σ outQty over the last REORDER_USAGE_WINDOW_DAYS ÷ window
 *   reorderLevel  = avgDailyUsage × leadTimeDays          (coverage horizon)
 *   threshold     = max(reorderLevel, lowStockThreshold)  (manual floor)
 *   isLow         = available (stock − reserved) <= threshold
 *
 * Lean by design: the 30-day trailing average follows a dying trend DOWN, so
 * the system naturally stops flagging cooling products — dead-stock protection.
 * The manual floor covers new / no-history items.
 */

/** Sampling window for average daily usage — long enough to be stable, short enough to track trend. */
export const REORDER_USAGE_WINDOW_DAYS = 30;

/**
 * Average daily outward qty per product over the trailing window, from
 * InvStockLedger (POSTED, non-deleted vouchers — same filter as the BI FSN
 * report). Optionally scoped to one branch. Products with no outward rows in
 * the window are simply absent from the map (treat as 0).
 */
export async function avgDailyUsageMap(opts: { branchId?: string | null } = {}): Promise<Map<number, number>> {
    const from = new Date();
    from.setDate(from.getDate() - REORDER_USAGE_WINDOW_DAYS);
    from.setHours(0, 0, 0, 0);

    const sums = await prisma.invStockLedger.groupBy({
        by: ["productId"],
        where: {
            ...(opts.branchId ? { branchId: opts.branchId } : {}),
            universalVoucher: { status: "POSTED", deletedAt: null },
            date: { gte: from },
            outQty: { gt: 0 },
        },
        _sum: { outQty: true },
    });

    return new Map(
        sums.map((s) => [s.productId, toNumber(s._sum.outQty ?? 0) / REORDER_USAGE_WINDOW_DAYS]),
    );
}

/** reorderLevel = avgDailyUsage × leadTimeDays, floored by the manual threshold. */
export function reorderThreshold(avgDailyUsage: number, leadTimeDays: number, lowStockThreshold: number): number {
    return Math.max(avgDailyUsage * leadTimeDays, lowStockThreshold);
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
