import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import {
    avgDailyUsageMap,
    reorderThreshold,
    clusterCostBands,
    REORDER_USAGE_WINDOW_DAYS,
} from "@/modules/inventory/lib/reorder";
import { loadLastInwardCostMap } from "@/modules/inventory/lib/valuation";

export const maxDuration = 60;

// GET /api/inventory/reports/reorder?branchId=<id>&grouped=1&tolerance=20
//
// Reorder-status report (Tally's "Reorder Status", complete formula):
//   avgDailyUsage = Σ outQty over last 30 days ÷ 30 (POSTED ledger rows)
//   reorderLevel  = avgDailyUsage × leadTimeDays (product override → org default)
//   threshold     = max(reorderLevel, lowStockThreshold)   ← manual floor
//   available     = stock − reserved (global view; per-branch stock when
//                   branchId is set — reservations are org-wide, so the branch
//                   view compares raw branch stock and reports reserved as info)
//   isLow / shortfall = the buy signal, low rows first.
//
// grouped=1 → Smart Reorder: items in the same leaf product group whose
// last-inward COST is within tolerance% (anchored to the band's cheapest) are
// substitutes — demand pooled per band (Σ usage, Σ available, max lead, max
// floor) so two brands of the same thing don't both get ordered. Rows gain
// costPaise + marginPct (procure-decision support); response gains `bands`.
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId") || null;
    const grouped = searchParams.get("grouped") === "1";
    const tolerancePct = Math.min(Math.max(Number(searchParams.get("tolerance")) || 20, 1), 100);

    const [products, usage, orgDefaults, branches] = await Promise.all([
        prisma.invProduct.findMany({
            where: { isActive: true },
            orderBy: { name: "asc" },
            select: {
                id: true, sku: true, name: true,
                stock: true, reserved: true,
                lowStockThreshold: true, leadTimeDays: true,
                effectiveSalePricePaise: true,
                groupId: true,
                // BOM-output check: produced in-house → never a procurement
                // signal (its demand reaches the purchasable parent via the
                // parent's consumption outQty rows).
                bomOutputs: { select: { id: true }, take: 1 },
                unit: { select: { code: true } },
                group: { select: { name: true } },
                brand: { select: { name: true } },
                category: { select: { name: true } },
                ...(branchId ? { branchStocks: { where: { branchId }, select: { stock: true } } } : {}),
            },
        }),
        avgDailyUsageMap({ branchId }),
        prisma.orgDefaults.findUnique({ where: { id: 1 }, select: { defaultLeadTimeDays: true } }),
        prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);

    // Last-inward cost — only walked in grouped mode (it's a per-product
    // valuation pass; the plain item-wise tab stays cheap).
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
        const avgDailyUsage = usage.get(p.id) ?? 0;
        const leadTimeDays = p.leadTimeDays ?? defaultLeadTimeDays;
        const reorderLevel = avgDailyUsage * leadTimeDays;
        const threshold = reorderThreshold(avgDailyUsage, leadTimeDays, p.lowStockThreshold);
        const isLow = available <= threshold;
        const costPaise = costMap.get(p.id) ?? null;
        return {
            id: p.id,
            sku: p.sku,
            name: p.name,
            /** BOM output — made in-house, excluded from Smart procurement bands. */
            inHouse: p.bomOutputs.length > 0,
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
            shortfall: isLow ? r2(Math.max(threshold - available, 0)) : 0,
            // Procure-decision support (grouped mode): cost decides the band,
            // margin decides which brand to buy.
            costPaise,
            marginPct: costPaise && p.effectiveSalePricePaise
                ? r2(((p.effectiveSalePricePaise - costPaise) / costPaise) * 100)
                : null,
        };
    });

    // Buy signals first (largest shortfall), then alphabetical.
    rows.sort((a, b) => Number(b.isLow) - Number(a.isLow) || b.shortfall - a.shortfall || a.name.localeCompare(b.name));

    // ── Smart bands (grouped mode) ───────────────────────────────────────────
    let bands = null;
    if (grouped) {
        const rowById = new Map(rows.map((r) => [r.id, r]));
        // Smart = the PROCUREMENT list: BOM outputs (in-house repacks/assemblies)
        // are dropped — you make them, not buy them. They stay on the Item-wise
        // tab (badged "In-house") as the "go pack" signal.
        bands = clusterCostBands(
            rows.filter((r) => !r.inHouse)
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

    return NextResponse.json({
        windowDays: REORDER_USAGE_WINDOW_DAYS,
        defaultLeadTimeDays,
        tolerancePct,
        branches,
        lowCount: rows.filter((r) => r.isLow).length,
        rows,
        bands,
    });
}
