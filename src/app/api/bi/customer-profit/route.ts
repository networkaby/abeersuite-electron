import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { parseRange } from "@/modules/accountancy/lib/period";
import { loadMarginLines, marginPct, r2 } from "@/modules/bi/lib/marginEngine";
import { withApiError } from "@/shared/lib/api";

// Heavy aggregation: every sale line in the period + an inward-lot cost walk.
export const maxDuration = 60;

// GET /api/bi/customer-profit?from&to&branchId[&accountId]
//
// Without accountId: one row per customer — bills, qty, revenue, derived COGS,
// profit, margin %. Walk-in / cash sales (no party ledger) pool into one row
// with accountId = 0.
// With accountId (number, or 0 for the walk-in pool): item-wise breakup for
// that customer, same measure columns.
export const GET = withApiError("Failed to build the customer profit report", async (req: Request) => {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const { from, to } = parseRange(searchParams);
    const branchId = searchParams.get("branchId") || null;
    const accountParam = searchParams.get("accountId");

    const [{ lines, costMethod }, branches] = await Promise.all([
        loadMarginLines({ from, to, branchId }),
        prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);

    if (accountParam !== null) {
        // Drill-down: item-wise breakup for one customer (0 = walk-in pool).
        const accountId = Number(accountParam);
        const subset = lines.filter((l) => (l.accountId ?? 0) === accountId);
        const byItem = new Map<number, {
            productId: number; sku: string; name: string;
            qty: number; revenue: number; cogs: number; profit: number;
        }>();
        for (const l of subset) {
            const row = byItem.get(l.productId) ?? {
                productId: l.productId, sku: l.sku, name: l.productName,
                qty: 0, revenue: 0, cogs: 0, profit: 0,
            };
            row.qty += l.qtyOut;
            row.revenue += l.revenue;
            row.cogs += l.cogs;
            row.profit += l.profit;
            byItem.set(l.productId, row);
        }
        const items = [...byItem.values()]
            .map((r) => ({ ...r, qty: r2(r.qty), revenue: r2(r.revenue), cogs: r2(r.cogs), profit: r2(r.profit), marginPct: marginPct(r.revenue, r.profit) }))
            .sort((a, b) => b.profit - a.profit);
        return NextResponse.json({ period: { from, to }, costMethod, items });
    }

    const byCustomer = new Map<number, {
        accountId: number; bills: Set<number>;
        qty: number; revenue: number; cogs: number; profit: number;
    }>();
    for (const l of lines) {
        const key = l.accountId ?? 0;
        const row = byCustomer.get(key) ?? { accountId: key, bills: new Set<number>(), qty: 0, revenue: 0, cogs: 0, profit: 0 };
        row.bills.add(l.voucherId);
        row.qty += l.qtyOut;
        row.revenue += l.revenue;
        row.cogs += l.cogs;
        row.profit += l.profit;
        byCustomer.set(key, row);
    }

    const accountIds = [...byCustomer.keys()].filter((id) => id !== 0);
    const accounts = accountIds.length > 0
        ? await prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true } })
        : [];
    const nameById = new Map(accounts.map((a) => [a.id, a.name]));

    const rows = [...byCustomer.values()]
        .map((r) => ({
            accountId: r.accountId,
            name: r.accountId === 0 ? "Walk-in / Cash" : (nameById.get(r.accountId) ?? `Account #${r.accountId}`),
            bills: r.bills.size,
            qty: r2(r.qty),
            revenue: r2(r.revenue),
            cogs: r2(r.cogs),
            profit: r2(r.profit),
            marginPct: marginPct(r.revenue, r.profit),
        }))
        .sort((a, b) => b.profit - a.profit);

    const totals = rows.reduce(
        (t, r) => ({ bills: t.bills + r.bills, qty: t.qty + r.qty, revenue: t.revenue + r.revenue, cogs: t.cogs + r.cogs, profit: t.profit + r.profit }),
        { bills: 0, qty: 0, revenue: 0, cogs: 0, profit: 0 },
    );

    return NextResponse.json({
        period: { from, to },
        costMethod,
        branches,
        rows,
        totals: { ...totals, qty: r2(totals.qty), revenue: r2(totals.revenue), cogs: r2(totals.cogs), profit: r2(totals.profit), marginPct: marginPct(totals.revenue, totals.profit) },
    });
});
