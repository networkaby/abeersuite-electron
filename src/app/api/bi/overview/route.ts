import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { parseRange } from "@/modules/accountancy/lib/period";
import { loadMarginLines, marginPct, r2 } from "@/modules/bi/lib/marginEngine";

export const maxDuration = 60;

// GET /api/bi/overview?from&to&branchId
//
// The BI dashboard payload: headline KPIs (revenue / COGS / profit / margin %,
// bill + customer counts), a monthly revenue-vs-profit series across the
// period, and top-5 customers + items by profit.
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

    const bills = new Set<number>();
    const customers = new Set<number>();
    let revenue = 0, cogs = 0, profit = 0, qty = 0;
    for (const l of lines) {
        bills.add(l.voucherId);
        if (l.accountId !== null) customers.add(l.accountId);
        revenue += l.revenue;
        cogs += l.cogs;
        profit += l.profit;
        qty += l.qtyOut;
    }

    // Monthly series across the requested range (labels like "Apr 25").
    const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const monthly = new Map<string, { revenue: number; profit: number }>();
    const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
    while (cursor <= to) {
        monthly.set(monthKey(cursor), { revenue: 0, profit: 0 });
        cursor.setMonth(cursor.getMonth() + 1);
    }
    for (const l of lines) {
        const d = new Date(l.date);
        const m = monthly.get(monthKey(d));
        if (m) { m.revenue += l.revenue; m.profit += l.profit; }
    }
    const monthlySeries = [...monthly.entries()].map(([key, v]) => {
        const [y, m] = key.split("-").map(Number);
        const label = new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
        return { key, label, revenue: r2(v.revenue), profit: r2(v.profit) };
    });

    // Top-5 by profit — customers and items.
    const byCustomer = new Map<number, { accountId: number; profit: number; revenue: number }>();
    const byItem = new Map<number, { productId: number; name: string; profit: number; revenue: number }>();
    for (const l of lines) {
        const ck = l.accountId ?? 0;
        const c = byCustomer.get(ck) ?? { accountId: ck, profit: 0, revenue: 0 };
        c.profit += l.profit; c.revenue += l.revenue;
        byCustomer.set(ck, c);
        const i = byItem.get(l.productId) ?? { productId: l.productId, name: l.productName, profit: 0, revenue: 0 };
        i.profit += l.profit; i.revenue += l.revenue;
        byItem.set(l.productId, i);
    }
    const topCustomerRows = [...byCustomer.values()].sort((a, b) => b.profit - a.profit).slice(0, 5);
    const accountIds = topCustomerRows.map((c) => c.accountId).filter((id) => id !== 0);
    const accounts = accountIds.length > 0
        ? await prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true } })
        : [];
    const nameById = new Map(accounts.map((a) => [a.id, a.name]));

    return NextResponse.json({
        period: { from, to },
        costMethod,
        branches,
        kpis: {
            revenue: r2(revenue),
            cogs: r2(cogs),
            profit: r2(profit),
            marginPct: marginPct(revenue, profit),
            bills: bills.size,
            customers: customers.size,
            qty: r2(qty),
        },
        monthlySeries,
        topCustomers: topCustomerRows.map((c) => ({
            accountId: c.accountId,
            name: c.accountId === 0 ? "Walk-in / Cash" : (nameById.get(c.accountId) ?? `Account #${c.accountId}`),
            profit: r2(c.profit),
            revenue: r2(c.revenue),
        })),
        topItems: [...byItem.values()].sort((a, b) => b.profit - a.profit).slice(0, 5)
            .map((i) => ({ ...i, profit: r2(i.profit), revenue: r2(i.revenue) })),
    });
}
