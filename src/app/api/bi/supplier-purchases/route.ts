import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { parseRange } from "@/modules/accountancy/lib/period";
import { r2 } from "@/modules/bi/lib/marginEngine";
import { loadPurchaseLines } from "@/modules/bi/lib/purchaseLines";

export const maxDuration = 60;

// GET /api/bi/supplier-purchases?from&to&branchId
//
// Purchase volume per supplier (PURCHASE minus PURCHASE_RETURN, pre-tax):
// bills, qty, value, share of total, last purchase date.
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const { from, to } = parseRange(searchParams);
    const branchId = searchParams.get("branchId") || null;

    const [lines, branches] = await Promise.all([
        loadPurchaseLines({ from, to, branchId }),
        prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);

    const bySupplier = new Map<number, {
        accountId: number; bills: Set<number>; qty: number; value: number; lastPurchase: Date;
    }>();
    for (const l of lines) {
        const key = l.accountId ?? 0;
        const row = bySupplier.get(key) ?? { accountId: key, bills: new Set<number>(), qty: 0, value: 0, lastPurchase: l.date };
        row.bills.add(l.voucherId);
        row.qty += l.qty;
        row.value += l.value;
        if (l.date > row.lastPurchase) row.lastPurchase = l.date;
        bySupplier.set(key, row);
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
            lastPurchase: r.lastPurchase,
        }))
        .sort((a, b) => b.value - a.value);

    return NextResponse.json({
        period: { from, to },
        branches,
        rows,
        totals: { value: r2(totalValue), bills: rows.reduce((s, r) => s + r.bills, 0) },
    });
}
