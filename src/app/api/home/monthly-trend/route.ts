import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { canSeeBusinessHealth, loadMonthlyTrend, parseTrendMonths } from "@/modules/home/lib/businessHealth";

// Up to 12 months of P&L (two dated stock valuations each) on a cold cache.
export const maxDuration = 60;

// GET /api/home/monthly-trend?months=12 — Home "Sales and net profit" card.
export async function GET(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;
    if (!canSeeBusinessHealth(user.permissions)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    try {
        const months = parseTrendMonths(new URL(req.url).searchParams.get("months"));
        return NextResponse.json({ months, points: await loadMonthlyTrend(months) });
    } catch (err) {
        return handleApiError(err);
    }
}
