import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { reorderThreshold, clusterCostBands } from "@/modules/inventory/lib/reorder";
import { classifyProducts } from "@/modules/inventory/lib/movementClass";
import { loadLastInwardCostMap } from "@/modules/inventory/lib/valuation";

export const maxDuration = 60;

// GET /api/inventory/reports/reorder?branchId=<id>&grouped=1&tolerance=20
//
// Reorder-status report. Every row is classified by the movement engine
// (movementClass.ts: recency vs group→category→org bands) and the CLASS
// decides the treatment:
//
//   REGULAR    considered — level = avg daily usage (slow-band window) ×
//              lead time, floored by lowStockThreshold; LOW = red buy signal
//   NEW        considered — floor only (no history, benefit of the doubt)
//   SLOW       considered — usage over the longer window; LOW = amber REVIEW
//              (the machine never pushes buying for slow movers)
//   NON_MOVING skipped — no buy signal; shown in the "Skipped" section
//   DEAD       skipped — clearance candidate, never reorder
//   (in-house) skipped — BOM output; the purchasable parent carries demand
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

    const [products, orgDefaults, branches] = await Promise.all([
        prisma.invProduct.findMany({
            where: { isActive: true },
            orderBy: { name: "asc" },
            select: {
                id: true, sku: true, name: true, createdAt: true,
                stock: true, reserved: true,
                lowStockThreshold: true, leadTimeDays: true,
                effectiveSalePricePaise: true,
                groupId: true, categoryId: true,
                // BOM-output check: produced in-house → never a procurement signal.
                bomOutputs: { select: { id: true }, take: 1 },
                unit: { select: { code: true } },
                group: { select: { name: true } },
                brand: { select: { name: true } },
                category: { select: { name: true } },
                ...(branchId ? { branchStocks: { where: { branchId }, select: { stock: true } } } : {}),
            },
        }),
        prisma.orgDefaults.findUnique({ where: { id: 1 }, select: { defaultLeadTimeDays: true } }),
        prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);

    const movement = await classifyProducts(
        products.map((p) => ({ id: p.id, groupId: p.groupId, categoryId: p.categoryId, createdAt: p.createdAt })),
        { branchId },
    );

    // Last-inward cost — only walked in grouped mode (per-product valuation
    // pass; the item-wise tab stays cheap).
    const costMap = grouped
        ? await loadLastInwardCostMap(products.map((p) => ({ id: p.id, stock: p.stock })))
        : new Map<number, number | null>();

    const defaultLeadTimeDays = orgDefaults?.defaultLeadTimeDays ?? 7;
    const r2 = (n: number) => Math.round(n * 100) / 100;

    const rows = products.map((p) => {
        const stock = branchId
            ? ((p as { branchStocks?: { stock: number }[] }).branchStocks?.[0]?.stock ?? 0)
            : (p.stock ?? 0);
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
        const isLow = considered && available <= threshold;
        /** "buy" (red) | "review" (amber, slow movers) | "ok" | "skipped" */
        const signal = !considered ? "skipped" : !isLow ? "ok" : m.movementClass === "SLOW" ? "review" : "buy";

        const skipReason = inHouse
            ? "In-house (BOM output) — the purchasable parent carries this demand"
            : m.movementClass === "DEAD"
            ? `Dead — ${m.daysSinceLastSale == null ? "never sold" : `last sale ${m.daysSinceLastSale}d ago`}${m.blip ? " (recent lone sale = blip, not revival)" : ""} · band ${m.bands.deadAfterDays}d (${m.bands.source})`
            : m.movementClass === "NON_MOVING"
            ? `Non-moving — last sale ${m.daysSinceLastSale}d ago${m.blip ? " (recent lone sale = blip)" : ""} · band ${m.bands.nonMovingAfterDays}d (${m.bands.source})`
            : null;

        return {
            id: p.id,
            sku: p.sku,
            name: p.name,
            inHouse,
            movementClass: m.movementClass,
            daysSinceLastSale: m.daysSinceLastSale,
            activeDays: m.activeDays,
            clearanceDays: m.clearanceDays,
            blip: m.blip,
            usageWindowDays: m.usageWindowDays,
            bandSource: m.bands.source,
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
            shortfall: isLow ? r2(Math.max(threshold - available, 0)) : 0,
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
    // skipped last.
    const signalOrder: Record<string, number> = { buy: 0, review: 1, ok: 2, skipped: 3 };
    rows.sort((a, b) =>
        signalOrder[a.signal] - signalOrder[b.signal] || b.shortfall - a.shortfall || a.name.localeCompare(b.name));

    // ── Smart bands (grouped mode) — considered rows only ────────────────────
    let bands = null;
    if (grouped) {
        const rowById = new Map(rows.map((r) => [r.id, r]));
        bands = clusterCostBands(
            rows.filter((r) => r.signal !== "skipped")
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
