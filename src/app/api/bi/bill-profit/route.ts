import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { parseRange } from "@/modules/accountancy/lib/period";
import { loadBillAdjustments, loadMarginLines, marginPct, r2, type BillAdjustment } from "@/modules/bi/lib/marginEngine";

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
            qty: number; revenue: number; taxAmount: number; cogs: number; profit: number;
        }>();
        let voucherType: string | null = null;
        for (const l of lines) {
            if (l.voucherId !== voucherId) continue;
            voucherType = l.voucherType;
            const row = byItem.get(l.productId) ?? {
                productId: l.productId, sku: l.sku, name: l.productName,
                qty: 0, revenue: 0, taxAmount: 0, cogs: 0, profit: 0,
            };
            row.qty += l.qtyOut;
            row.revenue += l.revenue;
            row.taxAmount += l.taxAmount;
            row.cogs += l.cogs;
            row.profit += l.profit;
            byItem.set(l.productId, row);
        }
        // amountIncl — GST-inclusive amount (revenue + tax) — shown alongside
        // the pre-tax Revenue so staff can relate the row back to the
        // tax-inclusive price they actually billed at.
        const items = [...byItem.values()]
            .map(({ taxAmount, ...r }) => ({
                ...r, qty: r2(r.qty), revenue: r2(r.revenue), cogs: r2(r.cogs), profit: r2(r.profit),
                amountIncl: r2(r.revenue + taxAmount),
                marginPct: marginPct(r.revenue, r.profit),
            }))
            .sort((a, b) => b.revenue - a.revenue);

        // Bill-level adjustments (overall discount, coupon/loyalty/service
        // charges, round-off) sit below the items — same reader as the list.
        const grossProfit = r2(items.reduce((s, r) => s + r.profit, 0));
        const grossRevenue = r2(items.reduce((s, r) => s + r.revenue, 0));
        const adjMap = voucherType
            ? await loadBillAdjustments([{ voucherId, voucherType }])
            : new Map<number, BillAdjustment>();
        const adj = adjMap.get(voucherId) ?? { discount: 0, charge: 0, roundOff: 0, shippingNet: 0, net: 0 };
        const netProfit = r2(grossProfit + adj.net);
        return NextResponse.json({
            period: { from, to },
            costMethod,
            items,
            grossProfit,
            adjustment: adj,
            netProfit,
            netMarginPct: marginPct(grossRevenue, netProfit),
        });
    }

    const byBill = new Map<number, {
        voucherId: number; detailId: number | null; type: string; date: Date; accountId: number;
        items: Set<number>; qty: number; revenue: number; cogs: number; profit: number;
    }>();
    for (const l of lines) {
        const row = byBill.get(l.voucherId) ?? {
            voucherId: l.voucherId, detailId: l.detailId, type: l.voucherType, date: l.date, accountId: l.accountId ?? 0,
            items: new Set<number>(), qty: 0, revenue: 0, cogs: 0, profit: 0,
        };
        row.items.add(l.productId);
        row.qty += l.qtyOut;
        row.revenue += l.revenue;
        row.cogs += l.cogs;
        row.profit += l.profit;
        byBill.set(l.voucherId, row);
    }

    const [vouchers, accounts, adjustments] = await Promise.all([
        byBill.size > 0
            ? prisma.universalVoucher.findMany({ where: { id: { in: [...byBill.keys()] } }, select: { id: true, voucherNo: true } })
            : Promise.resolve([]),
        prisma.account.findMany({
            where: { id: { in: [...new Set([...byBill.values()].map((b) => b.accountId).filter((id) => id !== 0))] } },
            select: { id: true, name: true },
        }),
        loadBillAdjustments([...byBill.values()].map((b) => ({ voucherId: b.voucherId, voucherType: b.type }))),
    ]);
    const voucherNoById = new Map(vouchers.map((v) => [v.id, v.voucherNo]));
    const nameById = new Map(accounts.map((a) => [a.id, a.name]));
    const NO_ADJ = { discount: 0, charge: 0, roundOff: 0, shippingNet: 0, net: 0 };

    const rows = [...byBill.values()]
        .map((b) => {
            const adj = adjustments.get(b.voucherId) ?? NO_ADJ;
            const profit = r2(b.profit);
            const netProfit = r2(profit + adj.net);
            return {
                voucherId: b.voucherId,
                detailId: b.detailId,
                voucherNo: voucherNoById.get(b.voucherId) ?? `#${b.voucherId}`,
                type: b.type,
                date: b.date,
                accountId: b.accountId,
                party: b.accountId === 0 ? "Walk-in / Cash" : (nameById.get(b.accountId) ?? `Account #${b.accountId}`),
                items: b.items.size,
                qty: r2(b.qty),
                revenue: r2(b.revenue),
                cogs: r2(b.cogs),
                profit,
                marginPct: marginPct(b.revenue, profit),
                billAdjustment: adj,
                netProfit,
                netMarginPct: marginPct(b.revenue, netProfit),
            };
        })
        .sort((a, b) => +new Date(b.date) - +new Date(a.date));

    // Adjustment columns are noise on a period with none of them — the UI
    // hides Bill adj./Net columns entirely when this is false.
    const hasAdjustments = rows.some((r) => r.billAdjustment.net !== 0);

    const totals = rows.reduce(
        (t, r) => ({
            qty: t.qty + r.qty, revenue: t.revenue + r.revenue, cogs: t.cogs + r.cogs,
            profit: t.profit + r.profit, netProfit: t.netProfit + r.netProfit,
        }),
        { qty: 0, revenue: 0, cogs: 0, profit: 0, netProfit: 0 },
    );
    const lossBills = rows.filter((r) => r.netProfit < 0).length;

    return NextResponse.json({
        period: { from, to },
        costMethod,
        branches,
        rows,
        hasAdjustments,
        totals: {
            bills: rows.length,
            lossBills,
            qty: r2(totals.qty),
            revenue: r2(totals.revenue),
            cogs: r2(totals.cogs),
            profit: r2(totals.profit),
            marginPct: marginPct(totals.revenue, totals.profit),
            netProfit: r2(totals.netProfit),
            netMarginPct: marginPct(totals.revenue, totals.netProfit),
        },
    });
}
