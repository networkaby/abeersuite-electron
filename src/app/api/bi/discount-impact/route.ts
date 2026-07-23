import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { parseRange } from "@/modules/accountancy/lib/period";
import { loadMarginLines, marginPct, r2 } from "@/modules/bi/lib/marginEngine";

export const maxDuration = 60;

interface Bucket {
    key: number; name: string; sub: string | null;
    qty: number; gross: number; discount: number; revenue: number; cogs: number; profit: number;
    /** Bill-level ₹ (coupon redemptions / loyalty redeemed) — customer pivot only. */
    coupon: number; loyalty: number;
}

// GET /api/bi/discount-impact?from&to&branchId
//
// Line-level discounts (tier + manual — the GL Discount-Allowed leg mirrors
// line discountAmt, so lines are the full story there) in both pivots, PLUS
// bill-level coupon (CouponRedemption rows) and loyalty redeemed ₹ (the DEBIT
// GL legs on the configured redeem-expense ledger) attributed per customer.
// Item pivot stays line-only — bill-level ₹ can't honestly split over items.
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

    const byItem = new Map<number, Bucket>();
    const byCustomer = new Map<number, Bucket>();
    const customerByVoucher = new Map<number, number>();
    for (const l of lines) {
        customerByVoucher.set(l.voucherId, l.accountId ?? 0);
        const item = byItem.get(l.productId)
            ?? { key: l.productId, name: l.productName, sub: l.categoryName, qty: 0, gross: 0, discount: 0, revenue: 0, cogs: 0, profit: 0, coupon: 0, loyalty: 0 };
        item.qty += l.qtyOut; item.gross += l.grossValue; item.discount += l.discountAmt;
        item.revenue += l.revenue; item.cogs += l.cogs; item.profit += l.profit;
        byItem.set(l.productId, item);

        const ck = l.accountId ?? 0;
        const cust = byCustomer.get(ck)
            ?? { key: ck, name: "", sub: null, qty: 0, gross: 0, discount: 0, revenue: 0, cogs: 0, profit: 0, coupon: 0, loyalty: 0 };
        cust.qty += l.qtyOut; cust.gross += l.grossValue; cust.discount += l.discountAmt;
        cust.revenue += l.revenue; cust.cogs += l.cogs; cust.profit += l.profit;
        byCustomer.set(ck, cust);
    }

    // Bill-level giveaways, attributed to the voucher's customer.
    const voucherIds = [...customerByVoucher.keys()];
    const [couponRows, loyaltyConfig] = voucherIds.length > 0
        ? await Promise.all([
            prisma.couponRedemption.findMany({
                where: { universalVoucherId: { in: voucherIds }, reversedAt: null },
                select: { universalVoucherId: true, amount: true },
            }),
            prisma.loyaltyConfig.findUnique({ where: { id: 1 }, select: { redeemExpenseAccountId: true } }),
        ])
        : [[], null];
    const loyaltyRows = loyaltyConfig?.redeemExpenseAccountId && voucherIds.length > 0
        ? await prisma.voucherGlLine.findMany({
            where: {
                universalVoucherId: { in: voucherIds },
                accountId: loyaltyConfig.redeemExpenseAccountId,
                type: "DEBIT",
            },
            select: { universalVoucherId: true, amount: true },
        })
        : [];
    let couponTotal = 0, loyaltyTotal = 0;
    for (const c of couponRows) {
        const cust = byCustomer.get(customerByVoucher.get(c.universalVoucherId ?? -1) ?? -1);
        const amt = Number(c.amount);
        if (cust) cust.coupon += amt;
        couponTotal += amt;
    }
    for (const l of loyaltyRows) {
        const cust = byCustomer.get(customerByVoucher.get(l.universalVoucherId) ?? -1);
        const amt = Number(l.amount);
        if (cust) cust.loyalty += amt;
        loyaltyTotal += amt;
    }

    const accountIds = [...byCustomer.keys()].filter((id) => id !== 0);
    const accounts = accountIds.length > 0
        ? await prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true } })
        : [];
    const nameById = new Map(accounts.map((a) => [a.id, a.name]));
    for (const [key, row] of byCustomer) {
        row.name = key === 0 ? "Walk-in / Cash" : (nameById.get(key) ?? `Account #${key}`);
    }

    const finalize = (rows: Bucket[]) => rows
        .map((r) => ({
            ...r,
            qty: r2(r.qty), gross: r2(r.gross), discount: r2(r.discount),
            coupon: r2(r.coupon), loyalty: r2(r.loyalty),
            revenue: r2(r.revenue), cogs: r2(r.cogs), profit: r2(r.profit),
            discountPct: r.gross !== 0 ? r2((r.discount / r.gross) * 100) : 0,
            marginPct: marginPct(r.revenue, r.profit),
        }))
        .sort((a, b) => (b.discount + b.coupon + b.loyalty) - (a.discount + a.coupon + a.loyalty));

    const totals = [...byItem.values()].reduce(
        (t, r) => ({ gross: t.gross + r.gross, discount: t.discount + r.discount, revenue: t.revenue + r.revenue, profit: t.profit + r.profit }),
        { gross: 0, discount: 0, revenue: 0, profit: 0 },
    );

    return NextResponse.json({
        period: { from, to },
        costMethod,
        branches,
        byItem: finalize([...byItem.values()]),
        byCustomer: finalize([...byCustomer.values()]),
        totals: {
            gross: r2(totals.gross),
            discount: r2(totals.discount),
            discountPct: totals.gross !== 0 ? r2((totals.discount / totals.gross) * 100) : 0,
            coupon: r2(couponTotal),
            loyalty: r2(loyaltyTotal),
            revenue: r2(totals.revenue),
            profit: r2(totals.profit),
            marginPct: marginPct(totals.revenue, totals.profit),
        },
    });
}
