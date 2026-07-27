import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import {
    valueStockBatch,
    VALUATION_METHODS,
    type ValuationMethod,
} from "@/modules/inventory/lib/valuation";
import { unitTiers } from "@/modules/inventory/lib/unitFormat";

// Heavy aggregation: all active products + a per-product inward-lot valuation
// walk. Give Vercel headroom past the default 10s function limit so large
// inventories don't 504.
export const maxDuration = 60;

// GET /api/inventory/reports/stock-summary?method=LAST_INWARD|WEIGHTED_AVG|SIMPLE_AVG|FIFO|MONTHLY_AVG&branchId=<id>
//
// Returns one row per active product with:
//   - master fields (sku, name, stock, effectiveSalePricePaise, low-stock flag)
//   - grouping (group / category / brand) so the UI can pivot views client-side
//   - valuation block computed via `valueStockBatch` for the requested method
//   - stock is per-branch when branchId is supplied, otherwise global InvProduct.stock
// Also returns `branches` (id+name list) for the UI branch picker.
//
// Default method = OrgDefaults.valuationMethod. PR 3 removed the costPaise
// cache; cost is derived from the ledger walk in valuation.ts.
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const methodParam = searchParams.get("method");
    const orgDefaults = await prisma.orgDefaults.findUnique({
        where:  { id: 1 },
        select: { valuationMethod: true },
    });
    const orgDefault = (orgDefaults?.valuationMethod ?? "WEIGHTED_AVG") as ValuationMethod;
    const method: ValuationMethod = methodParam && VALUATION_METHODS.includes(methodParam as ValuationMethod)
        ? (methodParam as ValuationMethod)
        : orgDefault;
    const branchId = searchParams.get("branchId") ?? null;

    const [products, branches, allUnits] = await Promise.all([
        prisma.invProduct.findMany({
            where:   { isActive: true },
            orderBy: { name: "asc" },
            select: {
                id:                true,
                sku:               true,
                name:              true,
                stock:             true,
                lowStockThreshold: true,
                effectiveSalePricePaise: true,
                unit: { select: { id: true, code: true, label: true } },
                group:    { select: { id: true, name: true } },
                brand:    { select: { id: true, name: true } },
                category: { select: { id: true, name: true } },
                ...(branchId ? { branchStocks: { where: { branchId }, select: { stock: true } } } : {}),
            },
        }),
        prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
        // Whole master (~15 rows) — unit chains are resolved here rather than
        // client-side so the UI never has to walk KM → M → CM itself.
        prisma.invUnit.findMany({ select: { id: true, code: true, baseUnitId: true, conversionFactor: true } }),
    ]);

    // Tiers per unit, computed once — many products share a unit.
    const tiersByUnit = new Map<number, ReturnType<typeof unitTiers>>();
    const tiersFor = (unitId: number) => {
        let t = tiersByUnit.get(unitId);
        if (!t) { t = unitTiers(unitId, allUnits); tiersByUnit.set(unitId, t); }
        return t;
    };

    // Resolve effective stock per product for the requested scope
    const effectiveStock = (p: typeof products[number]): number => {
        if (!branchId) return p.stock ?? 0;
        const bs = (p as { branchStocks?: { stock: number }[] }).branchStocks;
        return bs && bs.length > 0 ? bs[0].stock : 0;
    };

    const valuations = await valueStockBatch(
        products.map((p) => ({ id: p.id, stock: effectiveStock(p) })),
        method,
    );

    const rows = products.map((p) => {
        const v = valuations.get(p.id);
        const stock = effectiveStock(p);
        return {
            id:                p.id,
            sku:               p.sku,
            name:              p.name,
            stock,
            lowStockThreshold: p.lowStockThreshold,
            effectiveSalePricePaise: p.effectiveSalePricePaise,
            // `tiers` largest-first, each factor in ROOT units — lets the UI
            // print "10 KM 150 M 5 CM" from the single stored integer.
            unit:              { ...p.unit, tiers: tiersFor(p.unit.id) },
            group:             p.group,
            brand:             p.brand,
            category:          p.category,
            isLow: stock <= p.lowStockThreshold,
            valuation: v
                ? { unitCost: v.unitCost, value: v.value, method: v.method, fallback: v.fallback }
                : { unitCost: 0, value: 0, method, fallback: "no-cost-basis" as const },
        };
    });

    return NextResponse.json({ method, branches, rows });
}
