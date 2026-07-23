import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { parseRange } from "@/modules/accountancy/lib/period";
import { loadMarginLines, marginPct, r2 } from "@/modules/bi/lib/marginEngine";
import { loadPurchaseLines } from "@/modules/bi/lib/purchaseLines";

// Heavy aggregation: every sale + purchase line in the period.
export const maxDuration = 60;

// GET /api/bi/party-sale-purchase?from&to&branchId
//
// One row per party showing both sides of the relationship — what we sold to
// them (pre-tax revenue + profit) and what we bought from them (pre-tax value).
// Net flow = sale − purchase. Party-less vouchers pool as "Walk-in / No party".
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const { from, to } = parseRange(searchParams);
    const branchId = searchParams.get("branchId") || null;

    const [{ lines, costMethod }, purchases, branches] = await Promise.all([
        loadMarginLines({ from, to, branchId }),
        loadPurchaseLines({ from, to, branchId }),
        prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);

    const byParty = new Map<number, {
        accountId: number; saleBills: Set<number>; sale: number; profit: number;
        purchaseBills: Set<number>; purchase: number;
    }>();
    const rowFor = (accountId: number) =>
        byParty.get(accountId) ?? {
            accountId, saleBills: new Set<number>(), sale: 0, profit: 0,
            purchaseBills: new Set<number>(), purchase: 0,
        };
    for (const l of lines) {
        const row = rowFor(l.accountId ?? 0);
        row.saleBills.add(l.voucherId);
        row.sale += l.revenue;
        row.profit += l.profit;
        byParty.set(row.accountId, row);
    }
    for (const p of purchases) {
        const row = rowFor(p.accountId ?? 0);
        row.purchaseBills.add(p.voucherId);
        row.purchase += p.value;
        byParty.set(row.accountId, row);
    }

    const accountIds = [...byParty.keys()].filter((id) => id !== 0);
    const accounts = accountIds.length > 0
        ? await prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true } })
        : [];
    const nameById = new Map(accounts.map((a) => [a.id, a.name]));

    const rows = [...byParty.values()]
        .map((r) => ({
            accountId: r.accountId,
            name: r.accountId === 0 ? "Walk-in / No party" : (nameById.get(r.accountId) ?? `Account #${r.accountId}`),
            saleBills: r.saleBills.size,
            sale: r2(r.sale),
            profit: r2(r.profit),
            marginPct: marginPct(r.sale, r.profit),
            purchaseBills: r.purchaseBills.size,
            purchase: r2(r.purchase),
            netFlow: r2(r.sale - r.purchase),
        }))
        .sort((a, b) => (Math.abs(b.sale) + Math.abs(b.purchase)) - (Math.abs(a.sale) + Math.abs(a.purchase)));

    const totals = rows.reduce(
        (t, r) => ({
            saleBills: t.saleBills + r.saleBills, sale: t.sale + r.sale, profit: t.profit + r.profit,
            purchaseBills: t.purchaseBills + r.purchaseBills, purchase: t.purchase + r.purchase,
        }),
        { saleBills: 0, sale: 0, profit: 0, purchaseBills: 0, purchase: 0 },
    );

    return NextResponse.json({
        period: { from, to },
        costMethod,
        branches,
        rows,
        totals: {
            ...totals,
            sale: r2(totals.sale), profit: r2(totals.profit), purchase: r2(totals.purchase),
            netFlow: r2(totals.sale - totals.purchase),
        },
    });
}
