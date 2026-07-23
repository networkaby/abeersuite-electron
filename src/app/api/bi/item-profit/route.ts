import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { parseRange } from "@/modules/accountancy/lib/period";
import { loadMarginLines, marginPct, r2 } from "@/modules/bi/lib/marginEngine";

export const maxDuration = 60;

// GET /api/bi/item-profit?from&to&branchId
//
// One row per product sold in the period: qty, revenue (pre-tax, after
// discount), avg sell rate, derived unit cost, COGS, profit, margin %.
// Each row carries category + brand so the UI can pivot client-side.
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const { from, to } = parseRange(searchParams);
    const branchId = searchParams.get("branchId") || null;

    const [{ lines, costMethod }, branches] = await Promise.all([
        loadMarginLines({ from, to, branchId }),
        prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);

    const byItem = new Map<number, {
        productId: number; sku: string; name: string;
        category: string | null; brand: string | null;
        qty: number; revenue: number; cogs: number; profit: number;
        unitCost: number; costFallback?: string;
    }>();
    for (const l of lines) {
        const row = byItem.get(l.productId) ?? {
            productId: l.productId, sku: l.sku, name: l.productName,
            category: l.categoryName, brand: l.brandName,
            qty: 0, revenue: 0, cogs: 0, profit: 0,
            unitCost: l.unitCost, costFallback: l.costFallback,
        };
        row.qty += l.qtyOut;
        row.revenue += l.revenue;
        row.cogs += l.cogs;
        row.profit += l.profit;
        byItem.set(l.productId, row);
    }

    const rows = [...byItem.values()]
        .map((r) => ({
            ...r,
            qty: r2(r.qty),
            revenue: r2(r.revenue),
            avgRate: r.qty !== 0 ? r2(r.revenue / r.qty) : 0,
            unitCost: r2(r.unitCost),
            cogs: r2(r.cogs),
            profit: r2(r.profit),
            marginPct: marginPct(r.revenue, r.profit),
        }))
        .sort((a, b) => b.profit - a.profit);

    const totals = rows.reduce(
        (t, r) => ({ qty: t.qty + r.qty, revenue: t.revenue + r.revenue, cogs: t.cogs + r.cogs, profit: t.profit + r.profit }),
        { qty: 0, revenue: 0, cogs: 0, profit: 0 },
    );

    return NextResponse.json({
        period: { from, to },
        costMethod,
        branches,
        rows,
        totals: { ...totals, qty: r2(totals.qty), revenue: r2(totals.revenue), cogs: r2(totals.cogs), profit: r2(totals.profit), marginPct: marginPct(totals.revenue, totals.profit) },
    });
}
