import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { parseRange } from "@/modules/accountancy/lib/period";
import { loadMarginLines, r2 } from "@/modules/bi/lib/marginEngine";

export const maxDuration = 60;

export type RfmSegment = "CHAMPION" | "LOYAL" | "BIG_SPENDER" | "NEW" | "AT_RISK" | "LOST" | "REGULAR";

// First match wins. Scores are 1–5 quintiles within the customer base.
function segmentFor(r: number, f: number, m: number): RfmSegment {
    if (r >= 4 && f >= 4 && m >= 4) return "CHAMPION";
    if (r >= 3 && f >= 4) return "LOYAL";
    if (m >= 4) return "BIG_SPENDER";
    if (r >= 4 && f <= 2) return "NEW";
    if (r <= 2 && f >= 3) return "AT_RISK";
    if (r <= 2 && f <= 2) return "LOST";
    return "REGULAR";
}

// GET /api/bi/rfm?from&to&branchId
//
// RFM segmentation per identified customer (walk-in pool excluded — no
// identity to segment). R = days since last purchase (relative to `to`),
// F = bills in the window, M = pre-tax revenue in the window. Each dimension
// scored 1–5 by quintile rank within the population, then mapped to segments.
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const { from, to } = parseRange(searchParams);
    const branchId = searchParams.get("branchId") || null;

    const [{ lines }, branches] = await Promise.all([
        loadMarginLines({ from, to, branchId }),
        prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);

    const byCustomer = new Map<number, { lastPurchase: Date; bills: Set<number>; revenue: number }>();
    for (const l of lines) {
        if (l.accountId === null) continue; // walk-in — unidentifiable
        const row = byCustomer.get(l.accountId) ?? { lastPurchase: l.date, bills: new Set<number>(), revenue: 0 };
        if (l.date > row.lastPurchase) row.lastPurchase = l.date;
        row.bills.add(l.voucherId);
        row.revenue += l.revenue;
        byCustomer.set(l.accountId, row);
    }

    const accountIds = [...byCustomer.keys()];
    const accounts = accountIds.length > 0
        ? await prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true } })
        : [];
    const nameById = new Map(accounts.map((a) => [a.id, a.name]));

    const base = accountIds.map((id) => {
        const c = byCustomer.get(id)!;
        return {
            accountId: id,
            name: nameById.get(id) ?? `Account #${id}`,
            lastPurchase: c.lastPurchase,
            daysAgo: Math.max(0, Math.floor((to.getTime() - c.lastPurchase.getTime()) / 86_400_000)),
            bills: c.bills.size,
            revenue: r2(c.revenue),
        };
    });

    // Quintile score 1–5 by rank: index 0 = best → 5. Ties share by rank order.
    const n = base.length;
    const scoreOf = new Map<number, { r: number; f: number; m: number }>();
    const assign = (sorted: typeof base, key: "r" | "f" | "m") => {
        sorted.forEach((row, i) => {
            const s = scoreOf.get(row.accountId) ?? { r: 3, f: 3, m: 3 };
            s[key] = n <= 1 ? 3 : 5 - Math.min(4, Math.floor((i * 5) / n));
            scoreOf.set(row.accountId, s);
        });
    };
    assign([...base].sort((a, b) => a.daysAgo - b.daysAgo), "r");   // most recent first
    assign([...base].sort((a, b) => b.bills - a.bills), "f");        // most bills first
    assign([...base].sort((a, b) => b.revenue - a.revenue), "m");    // highest revenue first

    const rows = base
        .map((row) => {
            const s = scoreOf.get(row.accountId)!;
            return { ...row, rScore: s.r, fScore: s.f, mScore: s.m, segment: segmentFor(s.r, s.f, s.m) };
        })
        .sort((a, b) => b.revenue - a.revenue);

    const SEGMENTS: RfmSegment[] = ["CHAMPION", "LOYAL", "BIG_SPENDER", "NEW", "AT_RISK", "LOST", "REGULAR"];
    const summary = SEGMENTS.map((segment) => {
        const subset = rows.filter((r) => r.segment === segment);
        return { segment, customers: subset.length, revenue: r2(subset.reduce((s, r) => s + r.revenue, 0)) };
    });

    return NextResponse.json({ period: { from, to }, branches, summary, rows });
}
