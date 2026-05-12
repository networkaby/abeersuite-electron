import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import {
    valueStockBatch,
    VALUATION_METHODS,
    type ValuationMethod,
} from "@/modules/inventory/lib/valuation";

// GET /api/inventory/reports/stock-summary?method=LAST_COST|WEIGHTED_AVG|FIFO|LIFO
//
// Returns one row per active product with:
//   - master fields (sku, name, stock, costPaise, pricePaise, low-stock flag)
//   - grouping (group / category / brand) so the UI can pivot views client-side
//   - valuation block computed via `valueStockBatch` for the requested method
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const methodParam = searchParams.get("method") ?? "LAST_COST";
    const method: ValuationMethod = VALUATION_METHODS.includes(methodParam as ValuationMethod)
        ? (methodParam as ValuationMethod)
        : "LAST_COST";

    const products = await prisma.invProduct.findMany({
        where:   { isActive: true },
        orderBy: { name: "asc" },
        select: {
            id:                true,
            sku:               true,
            name:              true,
            stock:             true,
            lowStockThreshold: true,
            costPaise:         true,
            pricePaise:        true,
            unit:     { select: { code: true, label: true } },
            group:    { select: { id: true, name: true } },
            brand:    { select: { id: true, name: true } },
            category: { select: { id: true, name: true } },
        },
    });

    const valuations = await valueStockBatch(
        products.map((p) => ({ id: p.id, stock: p.stock, costPaise: p.costPaise })),
        method,
    );

    const rows = products.map((p) => {
        const v = valuations.get(p.id);
        return {
            ...p,
            isLow: p.stock != null && p.stock <= p.lowStockThreshold,
            valuation: v
                ? { unitCost: v.unitCost, value: v.value, method: v.method, fallback: v.fallback }
                : { unitCost: 0, value: 0, method, fallback: "no-cost-basis" as const },
        };
    });

    return NextResponse.json({ method, rows });
}
