import { CUSTOMER_SALE_VOUCHER_TYPES } from "@/shared/lib/constants/accounting";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { valueStockBatch } from "@/modules/inventory/lib/valuation";
import { REORDER_HISTORY_DAYS, REORDER_LADDER } from "@/shared/lib/constants/inventory";

/**
 * Movement classification engine — the single "house lens" consumed by the
 * Reorder page, the Products list badge, and BI → Stock Health. (BI → FSN
 * stays a separate, turnover-based industry-standard lens.)
 *
 * Classes, by DAYS SINCE LAST ORGANIC SALE against per-item resolved bands:
 *
 *   NEW         never sold organically, created within reorderNewItemDays
 *   REGULAR     recent + ≥4 organic sale days in the slow-band window
 *   SLOW        recent + 2–3 organic sale days (ladder rung), or last organic
 *               sale between slowAfter and nonMovingAfter days ago
 *   NON_MOVING  last organic sale between nonMovingAfter and deadAfter
 *   DEAD        beyond deadAfter (or never sold + old)
 *
 * Band resolution walks: product's GROUP chain (leaf → ancestors) →
 * CATEGORY chain → OrgDefaults.reorder*AfterDays — same shape as the GST /
 * pricing cascades.
 *
 * ORGANIC vs CLEARANCE: a sale line whose realized pre-tax unit price
 * ((amount − taxAmount) ÷ qty) is ≤ cost × (1 + clearanceMarginCutoffPct%)
 * is CLEARANCE — stock leaving, never demand. Clearance quantities are
 * subtracted from the day's outward before anything counts: they feed no
 * usage average, refresh no recency, climb no ladder. Dumping dead stock at
 * discount can never resurrect its buy signal. (Cost basis = current
 * last-inward via the valuation cascade — an approximation of cost-at-sale,
 * good enough for classification.) Internal consumption (manufacturing /
 * repack outQty) has no sale line, so it stays organic — that is the
 * demand-translation path for in-house parents.
 *
 * PROMOTION LADDER (climbed only on organic days; falling needs no ladder —
 * recency alone demotes):
 *   1 organic day  → class stays, badged `blip` (judged by the gap between
 *                    the last two organic sales)
 *   ≥2 organic days in the slow window → SLOW (amber, human checkpoint)
 *   ≥4 organic days in the slow window → REGULAR (buy math resumes)
 *
 * Usage sampling is class-driven: REGULAR averages organic qty over the slow
 * band (default 30d); SLOW over the non-moving band (90d — thin data needs a
 * longer lens); other classes report 0 (no buy math).
 */

export type MovementClass = "NEW" | "REGULAR" | "SLOW" | "NON_MOVING" | "DEAD";

// The tuning knobs (REORDER_LADDER, REORDER_HISTORY_DAYS) are in
// shared/lib/constants/inventory.ts.

export interface MovementBands {
    slowAfterDays: number;
    nonMovingAfterDays: number;
    deadAfterDays: number;
    /** Where the winning override came from — shown on Stock Health. */
    source: string;
}

export interface MovementInfo {
    movementClass: MovementClass;
    /** Days since the last ORGANIC sale; null = never sold organically. */
    daysSinceLastSale: number | null;
    lastSaleDate: Date | null;
    /** Distinct ORGANIC sale days inside the slow-band window. */
    activeDays: number;
    /** Days with clearance-priced sales inside the slow-band window. */
    clearanceDays: number;
    /** Class-driven average daily ORGANIC usage (0 for NEW/NON_MOVING/DEAD). */
    avgDailyUsage: number;
    /** Window (days) the average was sampled over. */
    usageWindowDays: number;
    /** True when a lone organic sale was ignored by the revival guard. */
    blip: boolean;
    bands: MovementBands;
}

interface ProductInput {
    id: number;
    groupId: number | null;
    categoryId: number | null;
    createdAt: Date;
}

const DAY_MS = 86_400_000;
/** Sale-side voucher kinds (mirror of BI marginEngine's SALE_TYPES). */
const SALE_TYPES = CUSTOMER_SALE_VOUCHER_TYPES;

interface BandOverride {
    slowAfterDays: number | null;
    nonMovingAfterDays: number | null;
    deadAfterDays: number | null;
    parentId: number | null;
    name: string;
}

/**
 * Resolve the movement bands for every product: group chain → category chain
 * → org defaults. Partial overrides inherit per-field (a group may set only
 * deadAfterDays and ride the rest).
 */
export async function resolveBandsForProducts(
    products: ProductInput[],
): Promise<{ bandsByProduct: Map<number, MovementBands>; newItemDays: number; clearanceCutoffPct: number }> {
    const [groups, categories, org] = await Promise.all([
        prisma.invProductGroup.findMany({
            select: { id: true, name: true, parentId: true, slowAfterDays: true, nonMovingAfterDays: true, deadAfterDays: true },
        }),
        prisma.invCategory.findMany({
            select: { id: true, name: true, parentId: true, slowAfterDays: true, nonMovingAfterDays: true, deadAfterDays: true },
        }),
        prisma.orgDefaults.findUnique({
            where: { id: 1 },
            select: {
                reorderSlowAfterDays: true, reorderNonMovingAfterDays: true, reorderDeadAfterDays: true,
                reorderNewItemDays: true, clearanceMarginCutoffPct: true,
            },
        }),
    ]);

    const orgBands = {
        slowAfterDays: org?.reorderSlowAfterDays ?? 30,
        nonMovingAfterDays: org?.reorderNonMovingAfterDays ?? 90,
        deadAfterDays: org?.reorderDeadAfterDays ?? 180,
    };
    const newItemDays = org?.reorderNewItemDays ?? 60;
    const clearanceCutoffPct = org?.clearanceMarginCutoffPct != null ? toNumber(org.clearanceMarginCutoffPct) : 1;

    const groupById = new Map<number, BandOverride>(groups.map((g) => [g.id, g]));
    const catById = new Map<number, BandOverride>(categories.map((c) => [c.id, c]));

    // Walk a chain leaf→root collecting the first non-null value per field.
    const walkChain = (start: number | null, byId: Map<number, BandOverride>, kind: string) => {
        let slow: number | null = null, non: number | null = null, dead: number | null = null;
        let sourceName: string | null = null;
        let id = start;
        const seen = new Set<number>();
        while (id != null && !seen.has(id)) {
            seen.add(id);
            const node = byId.get(id);
            if (!node) break;
            if (slow == null && node.slowAfterDays != null) { slow = node.slowAfterDays; sourceName ??= node.name; }
            if (non == null && node.nonMovingAfterDays != null) { non = node.nonMovingAfterDays; sourceName ??= node.name; }
            if (dead == null && node.deadAfterDays != null) { dead = node.deadAfterDays; sourceName ??= node.name; }
            id = node.parentId;
        }
        return { slow, non, dead, source: sourceName ? `${kind}: ${sourceName}` : null };
    };

    // Cache per (groupId, categoryId) pair — thousands of products share few pairs.
    const cache = new Map<string, MovementBands>();
    const bandsByProduct = new Map<number, MovementBands>();
    for (const p of products) {
        const key = `${p.groupId ?? ""}:${p.categoryId ?? ""}`;
        let bands = cache.get(key);
        if (!bands) {
            const g = walkChain(p.groupId, groupById, "group");
            const c = walkChain(p.categoryId, catById, "category");
            bands = {
                slowAfterDays: g.slow ?? c.slow ?? orgBands.slowAfterDays,
                nonMovingAfterDays: g.non ?? c.non ?? orgBands.nonMovingAfterDays,
                deadAfterDays: g.dead ?? c.dead ?? orgBands.deadAfterDays,
                source: g.slow != null || g.non != null || g.dead != null
                    ? g.source!
                    : c.slow != null || c.non != null || c.dead != null
                    ? c.source!
                    : "org default",
            };
            cache.set(key, bands);
        }
        bandsByProduct.set(p.id, bands);
    }
    return { bandsByProduct, newItemDays, clearanceCutoffPct };
}

/**
 * Classify every given product. One ledger walk (product × date over the last
 * year, POSTED non-deleted, optional branch scope) + one sale-line scan (for
 * the clearance split) + one LAST_INWARD cost pass feed all classes.
 */
export async function classifyProducts(
    products: ProductInput[],
    opts: { branchId?: string | null } = {},
): Promise<Map<number, MovementInfo>> {
    const from = new Date(Date.now() - REORDER_HISTORY_DAYS * DAY_MS);
    from.setHours(0, 0, 0, 0);
    // Read only the asked products' history. Rows for any other product were
    // read and then never looked at — so a 50-row products page paid for the
    // whole catalogue's year of ledger and sale lines. Same answer, less read.
    const productIds = { in: products.map((p) => p.id) };

    const [{ bandsByProduct, newItemDays, clearanceCutoffPct }, dayRows, saleLines, valuations] = await Promise.all([
        resolveBandsForProducts(products),
        prisma.invStockLedger.groupBy({
            by: ["productId", "date"],
            where: {
                productId: productIds,
                ...(opts.branchId ? { branchId: opts.branchId } : {}),
                universalVoucher: { status: "POSTED" },
                date: { gte: from },
                outQty: { gt: 0 },
            },
            _sum: { outQty: true },
        }),
        prisma.voucherInventoryLine.findMany({
            where: {
                productId: productIds,
                universalVoucher: {
                    type: { in: [...SALE_TYPES] },
                    status: "POSTED",
                    date: { gte: from },
                    ...(opts.branchId ? { branchId: opts.branchId } : {}),
                },
            },
            select: {
                productId: true,
                quantity: true,
                freeQty: true,
                amount: true,
                taxAmount: true,
                universalVoucher: { select: { date: true } },
            },
        }),
        // Cost basis for the clearance test (current last-inward via the
        // valuation cascade; opening cost counts). Stock qty irrelevant here.
        valueStockBatch(products.map((p) => ({ id: p.id, stock: 0 })), "LAST_INWARD"),
    ]);

    // Clearance qty per product per day: realized pre-tax unit ≤ cost × (1+cutoff%).
    // Free qty is clearance by definition (₹0 realized).
    const dayKey = (d: Date) => Math.floor(d.getTime() / DAY_MS);
    const clearanceByProductDay = new Map<number, Map<number, number>>();
    for (const l of saleLines) {
        const cost = valuations.get(l.productId ?? -1)?.unitCost ?? 0;
        if (!l.productId) continue;
        const qty = toNumber(l.quantity);
        const free = toNumber(l.freeQty ?? 0);
        let clearanceQty = free;
        if (qty > 0 && cost > 0) {
            const netUnit = (toNumber(l.amount) - toNumber(l.taxAmount)) / qty;
            if (netUnit <= cost * (1 + clearanceCutoffPct / 100)) clearanceQty += qty;
        }
        if (clearanceQty <= 0) continue;
        const k = dayKey(l.universalVoucher.date);
        const days = clearanceByProductDay.get(l.productId) ?? new Map<number, number>();
        days.set(k, (days.get(k) ?? 0) + clearanceQty);
        clearanceByProductDay.set(l.productId, days);
    }

    // Per product: sale days sorted desc with ORGANIC qty (ledger out minus
    // that day's clearance qty, floored at 0).
    const byProduct = new Map<number, { date: Date; organicQty: number; hadClearance: boolean }[]>();
    for (const r of dayRows) {
        const out = toNumber(r._sum.outQty ?? 0);
        const clr = clearanceByProductDay.get(r.productId)?.get(dayKey(r.date)) ?? 0;
        const arr = byProduct.get(r.productId) ?? [];
        arr.push({ date: r.date, organicQty: Math.max(out - clr, 0), hadClearance: clr > 0 });
        byProduct.set(r.productId, arr);
    }
    for (const arr of byProduct.values()) arr.sort((a, b) => b.date.getTime() - a.date.getTime());

    const now = Date.now();
    const out = new Map<number, MovementInfo>();

    for (const p of products) {
        const bands = bandsByProduct.get(p.id)!;
        const allDays = byProduct.get(p.id) ?? [];
        const organicDays = allDays.filter((d) => d.organicQty > 0);
        const lastSaleDate = organicDays[0]?.date ?? null;
        const daysSince = lastSaleDate ? Math.floor((now - lastSaleDate.getTime()) / DAY_MS) : null;

        const inWindow = (windowDays: number) => organicDays.filter((d) => now - d.date.getTime() <= windowDays * DAY_MS);
        const slowWin = inWindow(bands.slowAfterDays);
        const activeDays = slowWin.length;
        const clearanceDays = allDays.filter(
            (d) => d.hadClearance && now - d.date.getTime() <= bands.slowAfterDays * DAY_MS,
        ).length;

        let movementClass: MovementClass;
        let blip = false;

        if (daysSince == null) {
            // No organic sale inside a year (clearance-only history counts as
            // never sold — you don't restock what only leaves at a loss).
            const ageDays = Math.floor((now - p.createdAt.getTime()) / DAY_MS);
            movementClass = ageDays <= newItemDays ? "NEW" : "DEAD";
        } else if (daysSince > bands.deadAfterDays) {
            movementClass = "DEAD";
        } else if (daysSince > bands.nonMovingAfterDays) {
            movementClass = "NON_MOVING";
        } else if (daysSince > bands.slowAfterDays) {
            movementClass = "SLOW";
        } else if (activeDays >= REORDER_LADDER.toRegularDays) {
            movementClass = "REGULAR";
        } else if (activeDays >= REORDER_LADDER.toSlowDays) {
            // Ladder rung 1: pattern exists, human checkpoint before money moves.
            movementClass = "SLOW";
        } else {
            // One lone organic day recently — judge by the silence BEFORE it.
            const prev = organicDays[1]?.date ?? null;
            const gapBefore = prev
                ? Math.floor((organicDays[0].date.getTime() - prev.getTime()) / DAY_MS)
                : Infinity;
            if (gapBefore > bands.deadAfterDays) { movementClass = "DEAD"; blip = true; }
            else if (gapBefore > bands.nonMovingAfterDays) { movementClass = "NON_MOVING"; blip = true; }
            else { movementClass = "SLOW"; }
        }

        // Class-driven usage sampling (organic qty only).
        let usageWindowDays = 0;
        let avgDailyUsage = 0;
        if (movementClass === "REGULAR") {
            usageWindowDays = bands.slowAfterDays;
            avgDailyUsage = slowWin.reduce((s, d) => s + d.organicQty, 0) / usageWindowDays;
        } else if (movementClass === "SLOW") {
            usageWindowDays = bands.nonMovingAfterDays;
            avgDailyUsage = inWindow(usageWindowDays).reduce((s, d) => s + d.organicQty, 0) / usageWindowDays;
        }

        out.set(p.id, {
            movementClass,
            daysSinceLastSale: daysSince,
            lastSaleDate,
            activeDays,
            clearanceDays,
            avgDailyUsage,
            usageWindowDays,
            blip,
            bands,
        });
    }
    return out;
}
