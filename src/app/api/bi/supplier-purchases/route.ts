import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { parseRange } from "@/modules/accountancy/lib/period";
import { loadMarginLines, marginPct, r2 } from "@/modules/bi/lib/marginEngine";
import { loadPurchaseLines } from "@/modules/bi/lib/purchaseLines";
import { withApiError } from "@/shared/lib/api";

export const maxDuration = 60;

// GET /api/bi/supplier-purchases?from&to&branchId
//
// Purchase volume per supplier (PURCHASE minus PURCHASE_RETURN, pre-tax):
// bills, qty, value, share of total, last purchase date — PLUS supplier
// profitability: each item's sale profit in the period is prorated across the
// suppliers who supplied it, by their share of the qty purchased (an item
// bought 70/30 from two suppliers splits its profit 70/30). Profit on goods
// with NO purchase in the period (opening / older stock) is shown as its own
// row so attributed profit still reconciles to total gross profit.
export const GET = withApiError("Failed to build the supplier purchases report", async (req: Request) => {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const { from, to } = parseRange(searchParams);
    const branchId = searchParams.get("branchId") || null;

    const [lines, { lines: saleLines, costMethod }, branches] = await Promise.all([
        loadPurchaseLines({ from, to, branchId }),
        loadMarginLines({ from, to, branchId }),
        prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);

    const bySupplier = new Map<number, {
        accountId: number; bills: Set<number>; qty: number; value: number; lastPurchase: Date;
        soldValue: number; profit: number;
    }>();
    for (const l of lines) {
        const key = l.accountId ?? 0;
        const row = bySupplier.get(key) ?? {
            accountId: key, bills: new Set<number>(), qty: 0, value: 0, lastPurchase: l.date,
            soldValue: 0, profit: 0,
        };
        row.bills.add(l.voucherId);
        row.qty += l.qty;
        row.value += l.value;
        if (l.date > row.lastPurchase) row.lastPurchase = l.date;
        bySupplier.set(key, row);
    }

    // ── Profitability attribution ────────────────────────────────────────────
    // Per product: net qty bought per supplier in the period → each supplier's
    // share of that product's sale revenue + profit.
    const supplierQtyByProduct = new Map<number, Map<number, number>>();
    for (const l of lines) {
        const m = supplierQtyByProduct.get(l.productId) ?? new Map<number, number>();
        m.set(l.accountId ?? 0, (m.get(l.accountId ?? 0) ?? 0) + l.qty);
        supplierQtyByProduct.set(l.productId, m);
    }
    const saleByProduct = new Map<number, { revenue: number; profit: number }>();
    for (const s of saleLines) {
        const row = saleByProduct.get(s.productId) ?? { revenue: 0, profit: 0 };
        row.revenue += s.revenue;
        row.profit += s.profit;
        saleByProduct.set(s.productId, row);
    }
    const olderStock = { soldValue: 0, profit: 0 };
    for (const [productId, sale] of saleByProduct) {
        const shares = supplierQtyByProduct.get(productId);
        const totalQty = shares ? [...shares.values()].reduce((a, b) => a + b, 0) : 0;
        if (!shares || totalQty <= 0) {
            // Sold from opening / pre-period stock — no supplier bought it here.
            olderStock.soldValue += sale.revenue;
            olderStock.profit += sale.profit;
            continue;
        }
        for (const [supplierId, qty] of shares) {
            const row = bySupplier.get(supplierId);
            if (!row) continue;
            const share = qty / totalQty;
            row.soldValue += sale.revenue * share;
            row.profit += sale.profit * share;
        }
    }

    const accountIds = [...bySupplier.keys()].filter((id) => id !== 0);
    const accounts = accountIds.length > 0
        ? await prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true } })
        : [];
    const nameById = new Map(accounts.map((a) => [a.id, a.name]));

    const totalValue = [...bySupplier.values()].reduce((s, r) => s + r.value, 0);
    const rows = [...bySupplier.values()]
        .map((r) => ({
            accountId: r.accountId || null,
            name: r.accountId === 0 ? "(no supplier)" : (nameById.get(r.accountId) ?? `Account #${r.accountId}`),
            bills: r.bills.size,
            qty: r2(r.qty),
            value: r2(r.value),
            sharePct: totalValue !== 0 ? r2((r.value / totalValue) * 100) : 0,
            lastPurchase: r.lastPurchase as Date | null,
            soldValue: r2(r.soldValue),
            profit: r2(r.profit),
            marginPct: marginPct(r.soldValue, r.profit),
        }))
        .sort((a, b) => b.value - a.value);

    // Goods sold from stock that predates the period get their own honest row.
    if (olderStock.soldValue !== 0 || olderStock.profit !== 0) {
        rows.push({
            accountId: null,
            name: "(opening / older stock)",
            bills: 0, qty: 0, value: 0, sharePct: 0, lastPurchase: null,
            soldValue: r2(olderStock.soldValue),
            profit: r2(olderStock.profit),
            marginPct: marginPct(olderStock.soldValue, olderStock.profit),
        });
    }

    const totalProfit = rows.reduce((s, r) => s + r.profit, 0);
    const totalSold = rows.reduce((s, r) => s + r.soldValue, 0);

    return NextResponse.json({
        period: { from, to },
        costMethod,
        branches,
        rows,
        totals: {
            value: r2(totalValue),
            bills: rows.reduce((s, r) => s + r.bills, 0),
            soldValue: r2(totalSold),
            profit: r2(totalProfit),
            marginPct: marginPct(totalSold, totalProfit),
        },
    });
});
