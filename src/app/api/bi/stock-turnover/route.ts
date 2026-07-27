import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { parseRange } from "@/modules/accountancy/lib/period";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { loadMarginLines, r2 } from "@/modules/bi/lib/marginEngine";
import { loadUnitCostMap } from "@/modules/inventory/lib/costBasis";

export const maxDuration = 60;

// GET /api/bi/stock-turnover?from&to&branchId
//
// Value-based turnover per product (more precise than FSN's qty view):
//   turnover = period COGS ÷ average inventory value
//   average inventory value = (opening value + closing value) / 2, both at the
//   derived unit cost; opening qty derived: closing − in + out.
//   days of inventory = period days ÷ turnover.
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const { from, to } = parseRange(searchParams);
    const branchId = searchParams.get("branchId") || null;
    const periodDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000));

    const ledgerWhere = {
        ...(branchId ? { branchId } : {}),
        universalVoucher: { status: "POSTED" as const, deletedAt: null },
    };

    const [{ lines, costMethod }, products, periodSums, branches] = await Promise.all([
        loadMarginLines({ from, to, branchId }),
        prisma.invProduct.findMany({
            where: { isActive: true },
            select: {
                id: true, sku: true, name: true, stock: true,
                category: { select: { name: true } },
                unit: { select: { code: true } },
                ...(branchId ? { branchStocks: { where: { branchId }, select: { stock: true } } } : {}),
            },
        }),
        prisma.invStockLedger.groupBy({
            by: ["productId"],
            where: { ...ledgerWhere, date: { gte: from, lte: to } },
            _sum: { inQty: true, outQty: true },
        }),
        prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);

    const cogsByProduct = new Map<number, number>();
    for (const l of lines) {
        cogsByProduct.set(l.productId, (cogsByProduct.get(l.productId) ?? 0) + l.cogs);
    }
    const sumByProduct = new Map(periodSums.map((s) => [s.productId, s]));

    const effectiveStock = (p: typeof products[number]): number => {
        if (!branchId) return p.stock ?? 0;
        const bs = (p as { branchStocks?: { stock: number }[] }).branchStocks;
        return bs && bs.length > 0 ? bs[0].stock : 0;
    };

    const costMap = await loadUnitCostMap(products.map((p) => p.id), to, costMethod);

    const rows = [];
    for (const p of products) {
        const cogs = cogsByProduct.get(p.id) ?? 0;
        const sums = sumByProduct.get(p.id);
        const inQty = sums ? toNumber(sums._sum.inQty ?? 0) : 0;
        const outQty = sums ? toNumber(sums._sum.outQty ?? 0) : 0;
        const closing = effectiveStock(p);
        if (cogs === 0 && closing <= 0 && inQty === 0 && outQty === 0) continue;

        const unitCost = costMap.get(p.id)?.unitCost ?? 0;
        const opening = Math.max(closing - inQty + outQty, 0);
        const avgInventory = ((opening + closing) / 2) * unitCost;
        const turnover = avgInventory > 0 ? cogs / avgInventory : null;
        rows.push({
            productId: p.id,
            sku: p.sku,
            name: p.name,
            category: p.category?.name ?? null,
            unit: p.unit?.code ?? null,
            cogs: r2(cogs),
            avgInventory: r2(avgInventory),
            turnover: turnover !== null ? r2(turnover) : null,
            daysOfInventory: turnover && turnover > 0 ? Math.round(periodDays / turnover) : null,
            stock: r2(closing),
            stockValue: r2(closing > 0 ? closing * unitCost : 0),
        });
    }

    // Slowest first — the "money stuck" view (null turnover = never sold, top).
    rows.sort((a, b) => (a.turnover ?? -1) - (b.turnover ?? -1) || b.stockValue - a.stockValue);

    return NextResponse.json({ period: { from, to }, periodDays, costMethod, branches, rows });
}
