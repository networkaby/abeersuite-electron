import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth, requireAnyPermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { couponConfigUpdateSchema } from "@/shared/lib/schemas/couponConfigSchemas";

// GET /api/coupons/config — singleton (auto-upsert id=1). Read-only to any authed user.
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const config = await prisma.couponConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
        return NextResponse.json(config);
    } catch (e) {
        return handleApiError(e, "Failed to fetch coupon config");
    }
}

// PATCH /api/coupons/config — edit the global guard / ledger wiring.
// maxTotalDiscountPct caps coupon + spend-tier + loyalty together, so it is editable
// from the Spend Tiers page as well as Coupons — either page's edit right will do.
export async function PATCH(req: Request) {
    const { response } = await requireAnyPermission(PERMISSIONS.COUPONS_EDIT, PERMISSIONS.TIERS_EDIT);
    if (response) return response;
    const { data, error } = await validateRequest(req, couponConfigUpdateSchema);
    if (error) return error;
    try {
        const config = await prisma.couponConfig.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
        return NextResponse.json(config);
    } catch (e) {
        return handleApiError(e, "Failed to update coupon config");
    }
}
