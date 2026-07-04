import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth, requireAnyPermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { loyaltyConfigUpdateSchema } from "@/shared/lib/schemas/loyaltySchemas";

// GET /api/loyalty/config — singleton; auto-creates row id=1 if missing.
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;

    const row = await prisma.loyaltyConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    return NextResponse.json(row);
}

// PATCH /api/loyalty/config — edit earn/redeem rates + expiry window.
export async function PATCH(req: Request) {
    const { response } = await requireAnyPermission(PERMISSIONS.LOYALTY_EDIT, PERMISSIONS.LOYALTY_MANAGE);
    if (response) return response;

    const { data, error } = await validateRequest(req, loyaltyConfigUpdateSchema);
    if (error) return error;

    try {
        const row = await prisma.loyaltyConfig.upsert({
            where: { id: 1 },
            create: { id: 1, ...data },
            update: data,
        });
        return NextResponse.json(row);
    } catch (e) {
        return handleApiError(e, "Failed to update loyalty config");
    }
}
