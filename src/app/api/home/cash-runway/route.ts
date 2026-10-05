import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { canSeeBusinessHealth, loadCashRunway } from "@/modules/home/lib/businessHealth";

// GET /api/home/cash-runway — Home "Cash runway" card: liquid fund ÷ the last
// 3 months' average money out.
export async function GET() {
    const { user, response } = await requireAuth();
    if (response) return response;
    if (!canSeeBusinessHealth(user.permissions)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    try {
        return NextResponse.json(await loadCashRunway());
    } catch (err) {
        return handleApiError(err);
    }
}
