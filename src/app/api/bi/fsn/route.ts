import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { parseRange } from "@/modules/accountancy/lib/period";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { r2 } from "@/modules/bi/lib/marginEngine";
import { valueStockBatch, VALUATION_METHODS, type ValuationMethod } from "@/modules/inventory/lib/valuation";
import { loadLiveStockMap } from "@/modules/inventory/lib/liveStock";
import { withApiError } from "@/shared/lib/api";
import { FAST_MIN_TURNOVER } from "@/shared/lib/constants/inventory";

export const maxDuration = 60;

export type FsnClass = "FAST" | "SLOW" | "NON_MOVING";

// GET /api/bi/fsn?from&to&branchId
//
// Fast / Slow / Non-moving classification per product within the period:
//   • outward qty from InvStockLedger (POSTED, non-deleted vouchers)
//   • turnover = out ÷ avg stock, avg = (opening + closing) / 2
//     (opening derived: closing − in + out during the period)
//   • Non-moving = zero outward in period with stock on hand → dead stock,
//     with the on-hand value locked (org valuation method).
// Products with no stock AND no movement are skipped.
export const GET = withApiError("Failed to build the FSN analysis", async (req: Request) => {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const { from, to } = parseRange(searchParams);
    const branchId = searchParams.get("branchId") || null;

    const ledgerWhere = {
        ...(branchId ? { branchId } : {}),
        universalVoucher: { status: "POSTED" as const, deletedAt: null },
    };

    const [products, periodSums, lastOut, orgDefaults, branches] = await Promise.all([
        prisma.invProduct.findMany({
            where: { isActive: true },
            select: {
                id: true, sku: true, name: true, openingStock: true, openingBranchId: true,
                category: { select: { name: true } },
                brand: { select: { name: true } },
                unit: { select: { code: true } },
            },
        }),
        prisma.invStockLedger.groupBy({
            by: ["productId"],
            where: { ...ledgerWhere, date: { gte: from, lte: to } },
            _sum: { inQty: true, outQty: true },
        }),
        prisma.invStockLedger.groupBy({
            by: ["productId"],
            where: { ...ledgerWhere, outQty: { gt: 0 }, date: { lte: to } },
            _max: { date: true },
        }),
        prisma.orgDefaults.findUnique({ where: { id: 1 }, select: { valuationMethod: true } }),
        prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);

    const sumByProduct = new Map(periodSums.map((s) => [s.productId, s]));
    const lastOutByProduct = new Map(lastOut.map((s) => [s.productId, s._max.date]));

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

    const rows: {
        productId: number; sku: string; name: string;
        category: string | null; brand: string | null; unit: string | null;
        fsnClass: FsnClass; qtyOut: number; stock: number;
        turnover: number | null; lastSaleDate: Date | null; stockValue: number;
    }[] = [];

    for (const p of products) {
        const sums = sumByProduct.get(p.id);
        const inQty = sums ? toNumber(sums._sum.inQty ?? 0) : 0;
        const outQty = sums ? toNumber(sums._sum.outQty ?? 0) : 0;
        const closing = effectiveStock(p);
        if (outQty <= 0 && closing <= 0 && inQty <= 0) continue; // dormant SKU, nothing to say

        const opening = Math.max(closing - inQty + outQty, 0);
        const avgStock = (opening + closing) / 2;
        const turnover = avgStock > 0 ? outQty / avgStock : null;

        let fsnClass: FsnClass;
        if (outQty <= 0) fsnClass = "NON_MOVING";
        else if (turnover === null || turnover >= FAST_MIN_TURNOVER) fsnClass = "FAST";
        else fsnClass = "SLOW";

        rows.push({
            productId: p.id,
            sku: p.sku,
            name: p.name,
            category: p.category?.name ?? null,
            brand: p.brand?.name ?? null,
            unit: p.unit?.code ?? null,
            fsnClass,
            qtyOut: r2(outQty),
            stock: r2(closing),
            turnover: turnover !== null ? r2(turnover) : null,
            lastSaleDate: lastOutByProduct.get(p.id) ?? null,
            stockValue: r2(valuations.get(p.id)?.value ?? 0),
        });
    }

    // Fast first (highest turnover), then slow, then dead stock by locked value.
    const order: Record<FsnClass, number> = { FAST: 0, SLOW: 1, NON_MOVING: 2 };
    rows.sort((a, b) => order[a.fsnClass] - order[b.fsnClass] || (b.turnover ?? 0) - (a.turnover ?? 0) || b.stockValue - a.stockValue);

    const summary = (["FAST", "SLOW", "NON_MOVING"] as FsnClass[]).map((cls) => {
        const subset = rows.filter((r) => r.fsnClass === cls);
        return {
            fsnClass: cls,
            items: subset.length,
            stockValue: r2(subset.reduce((s, r) => s + r.stockValue, 0)),
        };
    });

    return NextResponse.json({ period: { from, to }, method, fastMinTurnover: FAST_MIN_TURNOVER, branches, summary, rows });
});
