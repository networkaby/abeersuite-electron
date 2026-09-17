import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import {
    valueStockBatch,
    VALUATION_METHODS,
    type ValuationMethod,
} from "@/modules/inventory/lib/valuation";
import { loadLiveStockMap } from "@/modules/inventory/lib/liveStock";

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
//   - stock comes from loadLiveStockMap (openingStock + ledger movement); the
//     ledger half is branch-scoped when branchId is supplied, and the opening
//     balance folds into every scope because it carries no branch
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

    const [products, branches] = await Promise.all([
        prisma.invProduct.findMany({
            where:   { isActive: true },
            orderBy: { name: "asc" },
            select: {
                id:                true,
                sku:               true,
                name:              true,
                openingStock:      true,
                openingBranchId:   true,
                lowStockThreshold: true,
                effectiveSalePricePaise: true,
                codes: { select: { kind: true, value: true } },
                unit: { select: { id: true, code: true, label: true } },
                group:    { select: { id: true, name: true } },
                brand:    { select: { id: true, name: true } },
                category: { select: { id: true, name: true } },
            },
        }),
        prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);

    // On-hand for the requested scope, from the formula rather than the caches —
    // the per-branch cache carries voucher movement only, so branch scope used to
    // drop every opening balance to zero (see liveStock.ts).
    const liveStock = await loadLiveStockMap(products, branchId);
    const effectiveStock = (p: typeof products[number]): number => liveStock.get(p.id) ?? 0;

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
            codes:             p.codes,
            stock,
            lowStockThreshold: p.lowStockThreshold,
            effectiveSalePricePaise: p.effectiveSalePricePaise,
            unit:              p.unit,
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
