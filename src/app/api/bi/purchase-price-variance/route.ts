import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { parseRange } from "@/modules/accountancy/lib/period";
import { r2 } from "@/modules/bi/lib/marginEngine";
import { loadPurchaseLines, PURCHASE_TYPE } from "@/modules/bi/lib/purchaseLines";
import { withApiError } from "@/shared/lib/api";

export const maxDuration = 60;

// GET /api/bi/purchase-price-variance?from&to&branchId[&productId]
//
// Same item bought at different rates in the period. Rate stats use POSITIVE
// purchase lines only (returns don't set prices). Items need ≥ 2 buys to have
// a variance. With productId: the dated buy list for the drill-down.
export const GET = withApiError("Failed to build the purchase price variance report", async (req: Request) => {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const { from, to } = parseRange(searchParams);
    const branchId = searchParams.get("branchId") || null;
    const productParam = searchParams.get("productId");

    const [lines, branches] = await Promise.all([
        loadPurchaseLines({ from, to, branchId }),
        prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);
    const buys = lines.filter((l) => l.voucherType === PURCHASE_TYPE && l.qty > 0 && l.rate > 0);

    if (productParam !== null) {
        const productId = Number(productParam);
        const subset = buys
            .filter((l) => l.productId === productId)
            .sort((a, b) => a.date.getTime() - b.date.getTime());
        const accountIds = [...new Set(subset.map((l) => l.accountId).filter((id): id is number => id !== null))];
        const accounts = accountIds.length > 0
            ? await prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true } })
            : [];
        const nameById = new Map(accounts.map((a) => [a.id, a.name]));
        return NextResponse.json({
            period: { from, to },
            entries: subset.map((l) => ({
                date: l.date,
                supplier: l.accountId !== null ? (nameById.get(l.accountId) ?? `Account #${l.accountId}`) : "(no supplier)",
                voucherId: l.voucherId,
                voucherNo: l.voucherNo,
                qty: r2(l.qty),
                rate: r2(l.rate),
                value: r2(l.value),
            })),
        });
    }

    const byProduct = new Map<number, {
        productId: number; sku: string; name: string; category: string | null;
        buys: number; qty: number; minRate: number; maxRate: number;
        latestRate: number; latestDate: Date; weightedValue: number;
    }>();
    for (const l of buys) {
        const row = byProduct.get(l.productId) ?? {
            productId: l.productId, sku: l.sku, name: l.productName, category: l.categoryName,
            buys: 0, qty: 0, minRate: l.rate, maxRate: l.rate,
            latestRate: l.rate, latestDate: l.date, weightedValue: 0,
        };
        row.buys += 1;
        row.qty += l.qty;
        row.weightedValue += l.qty * l.rate;
        if (l.rate < row.minRate) row.minRate = l.rate;
        if (l.rate > row.maxRate) row.maxRate = l.rate;
        if (l.date >= row.latestDate) { row.latestDate = l.date; row.latestRate = l.rate; }
        byProduct.set(l.productId, row);
    }

    const rows = [...byProduct.values()]
        .filter((r) => r.buys >= 2)
        .map((r) => {
            const weightedAvg = r.qty > 0 ? r.weightedValue / r.qty : 0;
            return {
                productId: r.productId,
                sku: r.sku,
                name: r.name,
                category: r.category,
                buys: r.buys,
                qty: r2(r.qty),
                minRate: r2(r.minRate),
                maxRate: r2(r.maxRate),
                latestRate: r2(r.latestRate),
                weightedAvg: r2(weightedAvg),
                variancePct: r.minRate > 0 ? r2(((r.maxRate - r.minRate) / r.minRate) * 100) : 0,
                trend: r.latestRate > weightedAvg * 1.02 ? "up" : r.latestRate < weightedAvg * 0.98 ? "down" : "flat",
            };
        })
        .sort((a, b) => b.variancePct - a.variancePct);

    return NextResponse.json({ period: { from, to }, branches, rows });
});
