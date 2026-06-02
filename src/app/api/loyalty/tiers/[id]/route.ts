import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { loyaltyTierUpdateSchema } from "@/shared/lib/schemas/loyaltySchemas";

// PATCH /api/loyalty/tiers/[id] — edit a tier's spend threshold / discount %.
// The 4 tiers are fixed (seeded); name + sortOrder are not editable here.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.LOYALTY_MANAGE);
    if (response) return response;

    const id = Number((await params).id);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const { data, error } = await validateRequest(req, loyaltyTierUpdateSchema);
    if (error) return error;

    try {
        const tier = await prisma.loyaltyTier.update({ where: { id }, data });
        return NextResponse.json(tier);
    } catch (e) {
        return handleApiError(e, "Failed to update tier");
    }
}
