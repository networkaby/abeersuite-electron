import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { classifyProducts, type MovementClass } from "@/modules/inventory/lib/movementClass";
import { valueStockBatch, VALUATION_METHODS, type ValuationMethod } from "@/modules/inventory/lib/valuation";
import { loadLiveStockMap } from "@/modules/inventory/lib/liveStock";
import { withApiError } from "@/shared/lib/api";

export const maxDuration = 60;

// GET /api/bi/stock-health?branchId=<id>
//
// The HOUSE movement lens (recency classes with group→category→org bands) —
// distinct from BI → FSN, which stays the textbook turnover lens. One engine
// (movementClass.ts) shared with the Reorder page, shown here in full detail:
// class, last sale, days since, active days, avg/day, the resolved band and
// WHERE it came from, stock on hand, value locked (org valuation method), and
// the action the Reorder page takes. Dormant SKUs (no stock, no movement,
// never sold) are skipped.
export const GET = withApiError("Failed to build the stock health report", async (req: Request) => {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId") || null;

    const [products, orgDefaults, branches] = await Promise.all([
        prisma.invProduct.findMany({
            where: { isActive: true },
            orderBy: { name: "asc" },
            select: {
                id: true, sku: true, name: true, createdAt: true,
                openingStock: true, openingBranchId: true, groupId: true, categoryId: true,
                codes: { select: { kind: true, value: true } },
                bomOutputs: { select: { id: true }, take: 1 },
                unit: { select: { code: true } },
                group: { select: { name: true } },
                brand: { select: { name: true } },
                category: { select: { name: true } },
            },
        }),
        prisma.orgDefaults.findUnique({ where: { id: 1 }, select: { valuationMethod: true } }),
        prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);

    const movement = await classifyProducts(
        products.map((p) => ({ id: p.id, groupId: p.groupId, categoryId: p.categoryId, createdAt: p.createdAt })),
        { branchId },
    );

    // On-hand from the formula, not the caches — the per-branch cache holds
    // voucher movement only, so branch scope used to drop every opening balance
    // to zero (see liveStock.ts).
    const liveStock = await loadLiveStockMap(products, branchId);
    const effectiveStock = (p: typeof products[number]): number => liveStock.get(p.id) ?? 0;

    const method: ValuationMethod = VALUATION_METHODS.includes(orgDefaults?.valuationMethod as ValuationMethod)
        ? (orgDefaults?.valuationMethod as ValuationMethod)
        : "WEIGHTED_AVG";
    const valuations = await valueStockBatch(
        products.map((p) => ({ id: p.id, stock: effectiveStock(p) })),
        method,
    );

    const r2 = (n: number) => Math.round(n * 100) / 100;

    interface HealthRow {
        id: number; sku: string; name: string;
        codes: { kind: string; value: string }[];
        unit: string | null; group: string | null; brand: string | null; category: string | null;
        inHouse: boolean;
        movementClass: MovementClass;
        blip: boolean;
        lastSaleDate: Date | null;
        daysSinceLastSale: number | null;
        activeDays: number;
        clearanceDays: number;
        avgDailyUsage: number;
        usageWindowDays: number;
        bands: { slowAfterDays: number; nonMovingAfterDays: number; deadAfterDays: number; source: string };
        stock: number;
        stockValue: number;
        action: string;
    }
    const rows: HealthRow[] = [];
    for (const p of products) {
        const m = movement.get(p.id)!;
        const stock = effectiveStock(p);
        // Dormant: never sold, nothing on hand — nothing to say.
        if (m.daysSinceLastSale == null && stock <= 0) continue;
        const inHouse = p.bomOutputs.length > 0;
        const action = inHouse
            ? "Skipped on Reorder — in-house (BOM output)"
            : m.movementClass === "REGULAR" ? "Reorder: full formula (red LOW = buy)"
            : m.movementClass === "NEW" ? "Reorder: manual floor only"
            : m.movementClass === "SLOW" ? "Reorder: amber REVIEW (never auto-pushed)"
            : m.movementClass === "NON_MOVING" ? "Skipped on Reorder — review / discount"
            : "Skipped on Reorder — clearance candidate";
        rows.push({
            id: p.id,
            sku: p.sku,
            name: p.name,
            codes: p.codes,
            unit: p.unit?.code ?? null,
            group: p.group?.name ?? null,
            brand: p.brand?.name ?? null,
            category: p.category?.name ?? null,
            inHouse,
            movementClass: m.movementClass,
            blip: m.blip,
            lastSaleDate: m.lastSaleDate,
            daysSinceLastSale: m.daysSinceLastSale,
            activeDays: m.activeDays,
            clearanceDays: m.clearanceDays,
            avgDailyUsage: r2(m.avgDailyUsage),
            usageWindowDays: m.usageWindowDays,
            bands: m.bands,
            stock: r2(stock),
            stockValue: r2(valuations.get(p.id)?.value ?? 0),
            action,
        });
    }

    // Worst first: Dead → Non-moving → Slow → New → Regular, biggest locked value first.
    const order: Record<MovementClass, number> = { DEAD: 0, NON_MOVING: 1, SLOW: 2, NEW: 3, REGULAR: 4 };
    rows.sort((a, b) => order[a.movementClass] - order[b.movementClass] || b.stockValue - a.stockValue);

    const summary = (Object.keys(order) as MovementClass[]).map((cls) => {
        const subset = rows.filter((r) => r.movementClass === cls);
        return {
            movementClass: cls,
            items: subset.length,
            stockValue: r2(subset.reduce((s, r) => s + r.stockValue, 0)),
        };
    });

    return NextResponse.json({ method, branches, summary, rows });
});
