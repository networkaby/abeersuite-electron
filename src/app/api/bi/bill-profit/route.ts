import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { parseRange } from "@/modules/accountancy/lib/period";
import { loadMarginLines, marginPct, r2 } from "@/modules/bi/lib/marginEngine";

// Heavy aggregation: every sale line in the period + an inward-lot cost walk.
export const maxDuration = 60;

// GET /api/bi/bill-profit?from&to&branchId[&voucherId]
//
// Without voucherId: one row per sale bill — party, items, qty, revenue,
// derived COGS, profit, margin %. Sale returns appear as their own (negative)
// bills so a costly return is visible, not silently netted into some other bill.
// With voucherId: item-wise breakup of that one bill.
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const { from, to } = parseRange(searchParams);
    const branchId = searchParams.get("branchId") || null;
    const voucherParam = searchParams.get("voucherId");

    const [{ lines, costMethod }, branches] = await Promise.all([
        loadMarginLines({ from, to, branchId }),
        prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);

    if (voucherParam !== null) {
        // Drill-down: item-wise breakup for one bill.
        const voucherId = Number(voucherParam);
        const byItem = new Map<number, {
            productId: number; sku: string; name: string;
            qty: number; revenue: number; cogs: number; profit: number;
        }>();
        for (const l of lines) {
            if (l.voucherId !== voucherId) continue;
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
            .sort((a, b) => b.revenue - a.revenue);
        return NextResponse.json({ period: { from, to }, costMethod, items });
    }

    const byBill = new Map<number, {
        voucherId: number; type: string; date: Date; accountId: number;
        items: Set<number>; qty: number; revenue: number; cogs: number; profit: number;
    }>();
    for (const l of lines) {
        const row = byBill.get(l.voucherId) ?? {
            voucherId: l.voucherId, type: l.voucherType, date: l.date, accountId: l.accountId ?? 0,
            items: new Set<number>(), qty: 0, revenue: 0, cogs: 0, profit: 0,
        };
        row.items.add(l.productId);
        row.qty += l.qtyOut;
        row.revenue += l.revenue;
        row.cogs += l.cogs;
        row.profit += l.profit;
        byBill.set(l.voucherId, row);
    }

    const [vouchers, accounts] = await Promise.all([
        byBill.size > 0
            ? prisma.universalVoucher.findMany({ where: { id: { in: [...byBill.keys()] } }, select: { id: true, voucherNo: true } })
            : Promise.resolve([]),
        prisma.account.findMany({
            where: { id: { in: [...new Set([...byBill.values()].map((b) => b.accountId).filter((id) => id !== 0))] } },
            select: { id: true, name: true },
        }),
    ]);
    const voucherNoById = new Map(vouchers.map((v) => [v.id, v.voucherNo]));
    const nameById = new Map(accounts.map((a) => [a.id, a.name]));

    const rows = [...byBill.values()]
        .map((b) => ({
            voucherId: b.voucherId,
            voucherNo: voucherNoById.get(b.voucherId) ?? `#${b.voucherId}`,
            type: b.type,
            date: b.date,
            accountId: b.accountId,
            party: b.accountId === 0 ? "Walk-in / Cash" : (nameById.get(b.accountId) ?? `Account #${b.accountId}`),
            items: b.items.size,
            qty: r2(b.qty),
            revenue: r2(b.revenue),
            cogs: r2(b.cogs),
            profit: r2(b.profit),
            marginPct: marginPct(b.revenue, b.profit),
        }))
        .sort((a, b) => +new Date(b.date) - +new Date(a.date));

    const totals = rows.reduce(
        (t, r) => ({ qty: t.qty + r.qty, revenue: t.revenue + r.revenue, cogs: t.cogs + r.cogs, profit: t.profit + r.profit }),
        { qty: 0, revenue: 0, cogs: 0, profit: 0 },
    );
    const lossBills = rows.filter((r) => r.profit < 0).length;

    return NextResponse.json({
        period: { from, to },
        costMethod,
        branches,
        rows,
        totals: {
            bills: rows.length,
            lossBills,
            qty: r2(totals.qty),
            revenue: r2(totals.revenue),
            cogs: r2(totals.cogs),
            profit: r2(totals.profit),
            marginPct: marginPct(totals.revenue, totals.profit),
        },
    });
}
