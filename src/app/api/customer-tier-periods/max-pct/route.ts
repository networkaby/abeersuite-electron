import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { maxTierPct } from "@/shared/lib/pricing/tierSpend";

// GET /api/customer-tier-periods/max-pct — the highest tier % any customer can
// get. Pre-fills Safety % on the product form.
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        return NextResponse.json({ pct: await maxTierPct(prisma) }, {
            headers: { "Cache-Control": "private, max-age=3600" },
        });
    } catch (e) {
        return handleApiError(e, "Failed to read tier discount");
    }
}
