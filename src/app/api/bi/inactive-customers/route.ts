import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { loadMarginLines, r2 } from "@/modules/bi/lib/marginEngine";

export const maxDuration = 60;

/** How far back we look for a customer's history (the win-back base). */
const BASE_WINDOW_MONTHS = 24;

// GET /api/bi/inactive-customers?days=90&branchId
//
// Identified customers whose LAST purchase is older than `days` (30/60/90/180),
// ranked by what they used to be worth. Base = last 24 months of sales; phone
// pulled from the linked person/company for the win-back call list.
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const daysParam = Number(searchParams.get("days"));
    const days = [30, 60, 90, 180].includes(daysParam) ? daysParam : 90;
    const branchId = searchParams.get("branchId") || null;

    const to = new Date();
    to.setHours(23, 59, 59, 999);
    const from = new Date(to);
    from.setMonth(from.getMonth() - BASE_WINDOW_MONTHS);
    from.setHours(0, 0, 0, 0);

    const [{ lines }, branches] = await Promise.all([
        loadMarginLines({ from, to, branchId }),
        prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);

    const byCustomer = new Map<number, { lastPurchase: Date; bills: Set<number>; revenue: number }>();
    for (const l of lines) {
        if (l.accountId === null) continue;
        const row = byCustomer.get(l.accountId) ?? { lastPurchase: l.date, bills: new Set<number>(), revenue: 0 };
        if (l.date > row.lastPurchase) row.lastPurchase = l.date;
        row.bills.add(l.voucherId);
        row.revenue += l.revenue;
        byCustomer.set(l.accountId, row);
    }

    const cutoffMs = to.getTime() - days * 86_400_000;
    const inactiveIds = [...byCustomer.entries()]
        .filter(([, c]) => c.lastPurchase.getTime() < cutoffMs)
        .map(([id]) => id);

    const accounts = inactiveIds.length > 0
        ? await prisma.account.findMany({
            where: { id: { in: inactiveIds } },
            select: {
                id: true,
                name: true,
                person: { select: { phones: { select: { phone: true }, take: 1 } } },
                company: { select: { phones: { select: { phone: true }, take: 1 } } },
            },
        })
        : [];
    const accountById = new Map(accounts.map((a) => [a.id, a]));

    const rows = inactiveIds
        .map((id) => {
            const c = byCustomer.get(id)!;
            const a = accountById.get(id);
            return {
                accountId: id,
                name: a?.name ?? `Account #${id}`,
                phone: a?.person?.phones[0]?.phone ?? a?.company?.phones[0]?.phone ?? null,
                lastPurchase: c.lastPurchase,
                daysAgo: Math.floor((to.getTime() - c.lastPurchase.getTime()) / 86_400_000),
                bills: c.bills.size,
                revenue: r2(c.revenue),
            };
        })
        .sort((a, b) => b.revenue - a.revenue);

    return NextResponse.json({
        baseWindowMonths: BASE_WINDOW_MONTHS,
        days,
        branches,
        activeCustomers: byCustomer.size - rows.length,
        rows,
    });
}
