import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { canSeeBusinessHealth, loadBusinessHealth, parseHealthPeriod } from "@/modules/home/lib/businessHealth";

// Up to 15 dated stock valuations on a cold cache.
export const maxDuration = 60;

// GET /api/home/business-health?days=15
// Home page "Business health" card: working capital, liquid fund and inventory
// value over the period. Each day's figures are cached (see businessHealth.ts).
export async function GET(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;
    if (!canSeeBusinessHealth(user.permissions)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    try {
        const days = parseHealthPeriod(new URL(req.url).searchParams.get("days"));
        return NextResponse.json({ days, points: await loadBusinessHealth(days) });
    } catch (err) {
        return handleApiError(err);
    }
}
