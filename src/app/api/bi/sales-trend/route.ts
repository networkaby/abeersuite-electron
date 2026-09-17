import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { parseRange } from "@/modules/accountancy/lib/period";
import { loadMarginLines, marginPct, r2, type MarginLine } from "@/modules/bi/lib/marginEngine";
import { withApiError } from "@/shared/lib/api";

export const maxDuration = 60;

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

function monthlyTotals(lines: MarginLine[]): Map<string, { revenue: number; profit: number }> {
    const out = new Map<string, { revenue: number; profit: number }>();
    for (const l of lines) {
        const key = monthKey(new Date(l.date));
        const m = out.get(key) ?? { revenue: 0, profit: 0 };
        m.revenue += l.revenue;
        m.profit += l.profit;
        out.set(key, m);
    }
    return out;
}

const shiftYear = (d: Date, by: number) => {
    const c = new Date(d);
    c.setFullYear(c.getFullYear() + by);
    return c;
};

// GET /api/bi/sales-trend?from&to&branchId
//
// Seasonality view: monthly revenue/profit for the range vs the SAME calendar
// months one year earlier (YoY), plus a day-of-week revenue profile.
export const GET = withApiError("Failed to build the sales trend", async (req: Request) => {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const { from, to } = parseRange(searchParams);
    const branchId = searchParams.get("branchId") || null;

    const [{ lines }, prior, branches] = await Promise.all([
        loadMarginLines({ from, to, branchId }),
        loadMarginLines({ from: shiftYear(from, -1), to: shiftYear(to, -1), branchId }),
        prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);

    const current = monthlyTotals(lines);
    const lastYear = monthlyTotals(prior.lines);

    const months: {
        key: string; label: string;
        revenue: number; profit: number; marginPct: number;
        lastYearRevenue: number; yoyPct: number | null;
    }[] = [];
    const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
    while (cursor <= to) {
        const key = monthKey(cursor);
        const cur = current.get(key) ?? { revenue: 0, profit: 0 };
        const prev = lastYear.get(monthKey(shiftYear(cursor, -1))) ?? { revenue: 0, profit: 0 };
        months.push({
            key,
            label: cursor.toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
            revenue: r2(cur.revenue),
            profit: r2(cur.profit),
            marginPct: marginPct(cur.revenue, cur.profit),
            lastYearRevenue: r2(prev.revenue),
            yoyPct: prev.revenue !== 0 ? r2(((cur.revenue - prev.revenue) / Math.abs(prev.revenue)) * 100) : null,
        });
        cursor.setMonth(cursor.getMonth() + 1);
    }

    // Day-of-week profile, Monday first.
    const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const dowTotals = DOW_LABELS.map((label) => ({ label, revenue: 0, profit: 0 }));
    for (const l of lines) {
        const jsDay = new Date(l.date).getDay(); // 0 = Sunday
        const idx = (jsDay + 6) % 7;
        dowTotals[idx].revenue += l.revenue;
        dowTotals[idx].profit += l.profit;
    }
    const dayOfWeek = dowTotals.map((d) => ({ ...d, revenue: r2(d.revenue), profit: r2(d.profit) }));

    return NextResponse.json({ period: { from, to }, branches, months, dayOfWeek });
});
