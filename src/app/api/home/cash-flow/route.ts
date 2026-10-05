import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { canSeeBusinessHealth, loadCashFlow, parseHealthPeriod } from "@/modules/home/lib/businessHealth";

// GET /api/home/cash-flow?days=15 — Home "Cash flow" card: money in / out of
// cash + bank per day (contras netted out). Cached 5 min (businessHealth.ts).
export async function GET(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;
    if (!canSeeBusinessHealth(user.permissions)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    try {
        const days = parseHealthPeriod(new URL(req.url).searchParams.get("days"));
        return NextResponse.json({ days, points: await loadCashFlow(days) });
    } catch (err) {
        return handleApiError(err);
    }
}
