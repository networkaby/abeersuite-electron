import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { reorderThreshold, suggestedOrderQty, clusterCostBands } from "@/modules/inventory/lib/reorder";
import { classifyProducts } from "@/modules/inventory/lib/movementClass";
import { loadLastInwardCostMap } from "@/modules/inventory/lib/valuation";
import { loadLiveStockMap } from "@/modules/inventory/lib/liveStock";
import { toNumber } from "@/modules/accountancy/lib/balance";

export const maxDuration = 60;

// GET /api/inventory/reports/reorder?branchId=<id>&grouped=1&tolerance=20
//
// Reorder-status report. Every row is classified by the movement engine
// (movementClass.ts: recency vs group→category→org bands) and the CLASS
// decides the treatment:
//
//   REGULAR    considered — level = avg daily usage (slow-band window) ×
//              lead time, floored by lowStockThreshold; LOW = red buy signal
//   NEW        considered — MANUAL FLOOR ONLY. No sale history means no demand
//              estimate, so an unset floor leaves threshold 0 and the row can
//              never go LOW (see the `threshold > 0` guard below) — silence,
//              not a fabricated buy signal
//   SLOW       considered — usage over the longer window; LOW = amber REVIEW
//              (the machine never pushes buying for slow movers)
//   NON_MOVING skipped — no buy signal; shown in the "Skipped" section
//   DEAD       skipped — clearance candidate, never reorder
//   (in-house) skipped — BOM output; the purchasable parent carries demand
//
// Cutting ACROSS the classes, `untouched` claims a row first (except in-house):
// no posted ledger row ever + no stock + no opening stock + no manual floor =
// a catalogue entry nobody has used. Its own section, not merged into Skipped,
// because "Dead" would be a lie — dead sold once and stopped, untouched never
// started.
//
// Every considered row also carries `orderQty` — the shortfall made PLACEABLE
// by the supplier's terms (minOrderQty floor, then rounded up to a whole
// orderPackQty). See suggestedOrderQty() in reorder.ts for the full reasoning.
//
// grouped=1 → Smart substitute bands (same leaf group + last-inward cost
// within tolerance% of the band's cheapest), built from CONSIDERED rows only.
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId") || null;
    const grouped = searchParams.get("grouped") === "1";
    const tolerancePct = Math.min(Math.max(Number(searchParams.get("tolerance")) || 20, 1), 100);

    const [products, orgDefaults, branches, ledgerProductIds] = await Promise.all([
        prisma.invProduct.findMany({
            where: { isActive: true },
            orderBy: { name: "asc" },
            select: {
                id: true, sku: true, name: true, createdAt: true,
                reserved: true,
                lowStockThreshold: true, leadTimeDays: true,
                orderPackQty: true, minOrderQty: true,
                openingStock: true,
                openingBranchId: true,
                effectiveSalePricePaise: true,
                groupId: true, categoryId: true,
                codes: { select: { kind: true, value: true } },
                // BOM-output check: produced in-house → never a procurement signal.
                bomOutputs: { select: { id: true }, take: 1 },
                unit: { select: { code: true } },
                group: { select: { name: true } },
                brand: { select: { name: true } },
                category: { select: { name: true } },
            },
        }),
        prisma.orgDefaults.findUnique({ where: { id: 1 }, select: { defaultLeadTimeDays: true } }),
        prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
        // Which products have EVER been transacted — any posted ledger row, in
        // or out, no date window. Deliberately NOT branch-scoped and NOT
        // filtered to outQty: "has this item ever been used?" is a fact about
        // the catalogue entry, not about one branch or one direction. Asking
        // the ledger directly (rather than inferring "never sold + zero stock")
        // keeps an item that was purchased and later written off out of the
        // Untouched bucket — it has a real history that happens to end at zero.
        prisma.invStockLedger.groupBy({
            by: ["productId"],
            where: { universalVoucher: { status: "POSTED" } },
        }),
    ]);
    const transactedIds = new Set(ledgerProductIds.map((l) => l.productId));

    // On-hand from the formula, not the caches — branch scope narrows the ledger
    // half only, so an opening balance is never dropped (see liveStock.ts).
    const liveStock = await loadLiveStockMap(products, branchId);

    const movement = await classifyProducts(
        products.map((p) => ({ id: p.id, groupId: p.groupId, categoryId: p.categoryId, createdAt: p.createdAt })),
        { branchId },
    );

    // Last-inward cost — only walked in grouped mode (per-product valuation
    // pass; the item-wise tab stays cheap).
    const costMap = grouped
        ? await loadLastInwardCostMap(products.map((p) => ({ id: p.id, stock: liveStock.get(p.id) ?? 0 })))
        : new Map<number, number | null>();

    const defaultLeadTimeDays = orgDefaults?.defaultLeadTimeDays ?? 7;
    const r2 = (n: number) => Math.round(n * 100) / 100;

    const rows = products.map((p) => {
        const stock = liveStock.get(p.id) ?? 0;
        // Reservations are org-wide (see StockReservation) — only the global
        // view can meaningfully subtract them.
        const available = branchId ? stock : stock - p.reserved;
        const m = movement.get(p.id)!;
        const inHouse = p.bomOutputs.length > 0;
        const leadTimeDays = p.leadTimeDays ?? defaultLeadTimeDays;

        // Treatment by class.
        const considered = !inHouse && (m.movementClass === "REGULAR" || m.movementClass === "NEW" || m.movementClass === "SLOW");
        const avgDailyUsage = considered ? m.avgDailyUsage : 0;
        const reorderLevel = avgDailyUsage * leadTimeDays;
        const threshold = considered ? reorderThreshold(avgDailyUsage, leadTimeDays, p.lowStockThreshold) : 0;
        // NO REORDER POINT → NO OPINION. threshold === 0 means the item has no
        // demand history AND no manual floor: nobody — machine or human — has
        // said what stock it should hold. The old test was `available <=
        // threshold`, so 0 <= 0 fired LOW on every never-sold zero-stock item
        // (752 of 777 "buy" signals on a freshly imported catalogue), each with
        // shortfall 0 — a buy order with nothing to buy. `0 × leadTime = 0` is
        // not knowledge that demand is zero, it is the absence of knowledge, and
        // the report must not launder one into the other.
        //
        // Negative stock is deliberately NOT a signal here: it means a purchase
        // voucher hasn't been entered yet and self-corrects when it is — a
        // paperwork lag, not a shortage.
        //
        // A no-history item earns a reorder point when a human sets
        // lowStockThreshold, or when sales accumulate and the movement ladder
        // promotes it NEW → SLOW → REGULAR.
        const isLow = considered && threshold > 0 && available <= threshold;

        // UNTOUCHED — a catalogue entry nobody has used yet. All four must hold:
        // no posted ledger row ever, no stock, no opening stock, and no manual
        // floor. That last one is the escape hatch, not a technicality: setting
        // a floor IS a human saying "I want to stock this", so the item leaves
        // the bucket and starts producing buy signals immediately.
        //
        // Kept out of the DEAD class deliberately. Dead means it used to sell
        // and stopped — clear it out. Untouched means it never started — either
        // begin stocking it or delete the entry. Different fact, different fix,
        // and after 60 days the movement engine would otherwise relabel these
        // as Dead purely on age and hide a typo'd catalogue row as a trading
        // failure. In-house still wins: for a BOM output, "the parent carries
        // this demand" is the more useful thing to say.
        const untouched = !inHouse
            && !transactedIds.has(p.id)
            && stock === 0
            && toNumber(p.openingStock ?? 0) === 0
            && p.lowStockThreshold === 0;

        /** "buy" (red) | "review" (amber, slow movers) | "ok" | "untouched" | "skipped" */
        const signal = inHouse ? "skipped"
            : untouched ? "untouched"
            : !considered ? "skipped"
            : !isLow ? "ok"
            : m.movementClass === "SLOW" ? "review"
            : "buy";

        const skipReason = inHouse
            ? "In-house (BOM output) — the purchasable parent carries this demand"
            : m.movementClass === "DEAD"
            ? `Dead — ${m.daysSinceLastSale == null ? "never sold" : `last sale ${m.daysSinceLastSale}d ago`}${m.blip ? " (recent lone sale = blip, not revival)" : ""} · band ${m.bands.deadAfterDays}d (${m.bands.source})`
            : m.movementClass === "NON_MOVING"
            ? `Non-moving — last sale ${m.daysSinceLastSale}d ago${m.blip ? " (recent lone sale = blip)" : ""} · band ${m.bands.nonMovingAfterDays}d (${m.bands.source})`
            : null;

        // What the shelf needs vs what the supplier will actually sell.
        const shortfall = isLow ? r2(Math.max(threshold - available, 0)) : 0;
        const orderQty = suggestedOrderQty(shortfall, p.orderPackQty, p.minOrderQty);

        return {
            id: p.id,
            sku: p.sku,
            name: p.name,
            codes: p.codes,
            inHouse,
            movementClass: m.movementClass,
            daysSinceLastSale: m.daysSinceLastSale,
            activeDays: m.activeDays,
            clearanceDays: m.clearanceDays,
            blip: m.blip,
            usageWindowDays: m.usageWindowDays,
            bandSource: m.bands.source,
            untouched,
            unit: p.unit?.code ?? null,
            group: p.group?.name ?? null,
            groupId: p.groupId,
            brand: p.brand?.name ?? null,
            category: p.category?.name ?? null,
            stock,
            reserved: p.reserved,
            available,
            avgDailyUsage: r2(avgDailyUsage),
            leadTimeDays,
            /** Product's own override; null = riding the org default. */
            ownLeadTimeDays: p.leadTimeDays,
            reorderLevel: r2(reorderLevel),
            lowStockThreshold: p.lowStockThreshold,
            threshold: r2(threshold),
            isLow,
            signal,
            skipReason,
            shortfall,
            /** Supplier terms — null = loose units / no floor. */
            orderPackQty: p.orderPackQty,
            minOrderQty: p.minOrderQty,
            /** Placeable quantity: shortfall → MOQ floor → rounded up to a pack. */
            orderQty,
            /** Whole packs in orderQty (null when the item is sold loose). */
            packs: p.orderPackQty && p.orderPackQty > 0 ? orderQty / p.orderPackQty : null,
            // Procure-decision support (grouped mode): cost decides the band,
            // margin decides which brand to buy.
            costPaise: costMap.get(p.id) ?? null,
            marginPct: (() => {
                const c = costMap.get(p.id);
                return c && p.effectiveSalePricePaise ? r2(((p.effectiveSalePricePaise - c) / c) * 100) : null;
            })(),
        };
    });

    // Buy signals first, then reviews, then ok (largest shortfall inside each),
    // then untouched, skipped last.
    const signalOrder: Record<string, number> = { buy: 0, review: 1, ok: 2, untouched: 3, skipped: 4 };
    rows.sort((a, b) =>
        signalOrder[a.signal] - signalOrder[b.signal] || b.shortfall - a.shortfall || a.name.localeCompare(b.name));

    // ── Smart bands (grouped mode) — considered rows only ────────────────────
    // No orderQty at band level ON PURPOSE: pack size and MOQ are per SUPPLIER
    // SKU, and members of one band are different brands with different packs.
    // The band tells you HOW MUCH the substitute group is short; the member row
    // you actually decide to buy carries the placeable quantity.
    let bands = null;
    if (grouped) {
        const rowById = new Map(rows.map((r) => [r.id, r]));
        bands = clusterCostBands(
            // Untouched rows are excluded alongside skipped: an item nobody has
            // ever traded contributes no demand to pool, and letting it join a
            // band would only dilute the substitutes that do sell.
            rows.filter((r) => r.signal !== "skipped" && r.signal !== "untouched")
                .map((r) => ({ id: r.id, groupId: r.groupId, groupName: r.group, costPaise: r.costPaise })),
            tolerancePct,
        ).map((band) => {
            const members = band.productIds.map((id) => rowById.get(id)!);
            const pooledUsage = members.reduce((s, m) => s + m.avgDailyUsage, 0);
            const pooledAvailable = members.reduce((s, m) => s + m.available, 0);
            const leadTimeDays = Math.max(...members.map((m) => m.leadTimeDays));
            const floor = Math.max(...members.map((m) => m.lowStockThreshold));
            const level = pooledUsage * leadTimeDays;
            const threshold = Math.max(level, floor);
            const isLow = pooledAvailable <= threshold;
            return {
                key: band.key,
                groupName: band.groupName,
                costMinPaise: band.costMinPaise,
                costMaxPaise: band.costMaxPaise,
                productIds: band.productIds,
                available: pooledAvailable,
                avgDailyUsage: r2(pooledUsage),
                leadTimeDays,
                reorderLevel: r2(level),
                threshold: r2(threshold),
                isLow,
                shortfall: isLow ? r2(Math.max(threshold - pooledAvailable, 0)) : 0,
            };
        });
        bands.sort((a, b) => Number(b.isLow) - Number(a.isLow) || b.shortfall - a.shortfall);
    }

    const counts = {
        buy: rows.filter((r) => r.signal === "buy").length,
        review: rows.filter((r) => r.signal === "review").length,
        untouched: rows.filter((r) => r.signal === "untouched").length,
        skipped: rows.filter((r) => r.signal === "skipped").length,
    };

    return NextResponse.json({
        defaultLeadTimeDays,
        tolerancePct,
        branches,
        counts,
        /** Kept for existing consumers: red buy count. */
        lowCount: counts.buy,
        rows,
        bands,
    });
}
