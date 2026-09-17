import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { parseRange } from "@/modules/accountancy/lib/period";
import { loadMarginLines, marginPct, r2 } from "@/modules/bi/lib/marginEngine";
import { withApiError } from "@/shared/lib/api";

export const maxDuration = 60;

// GET /api/bi/branch-comparison?from&to
//
// Per-branch performance from the margin lines (vouchers with no branch
// stamped pool under "(no branch)"). No branch filter here on purpose —
// the report IS the branch comparison.
export const GET = withApiError("Failed to build the branch comparison", async (req: Request) => {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const { from, to } = parseRange(searchParams);

    const [{ lines, costMethod }, branches] = await Promise.all([
        loadMarginLines({ from, to }),
        prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);
    const nameById = new Map(branches.map((b) => [b.id, b.name]));

    const byBranch = new Map<string, {
        branchId: string; bills: Set<number>;
        qty: number; revenue: number; cogs: number; profit: number;
    }>();
    for (const l of lines) {
        const key = l.branchId ?? "";
        const row = byBranch.get(key) ?? { branchId: key, bills: new Set<number>(), qty: 0, revenue: 0, cogs: 0, profit: 0 };
        row.bills.add(l.voucherId);
        row.qty += l.qtyOut;
        row.revenue += l.revenue;
        row.cogs += l.cogs;
        row.profit += l.profit;
        byBranch.set(key, row);
    }

    const totalRevenue = [...byBranch.values()].reduce((s, r) => s + r.revenue, 0);
    const rows = [...byBranch.values()]
        .map((r) => ({
            branchId: r.branchId || null,
            name: r.branchId ? (nameById.get(r.branchId) ?? r.branchId) : "(no branch)",
            bills: r.bills.size,
            qty: r2(r.qty),
            revenue: r2(r.revenue),
            sharePct: totalRevenue !== 0 ? r2((r.revenue / totalRevenue) * 100) : 0,
            cogs: r2(r.cogs),
            profit: r2(r.profit),
            marginPct: marginPct(r.revenue, r.profit),
            avgBill: r.bills.size > 0 ? r2(r.revenue / r.bills.size) : 0,
        }))
        .sort((a, b) => b.revenue - a.revenue);

    return NextResponse.json({ period: { from, to }, costMethod, rows });
});
