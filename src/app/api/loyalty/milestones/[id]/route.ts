import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAnyPermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError, parseIdParam } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { loyaltyMilestoneUpdateSchema } from "@/shared/lib/schemas/loyaltySchemas";

// PATCH /api/loyalty/milestones/[id] — edit threshold / bonus / label / enabled.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAnyPermission(PERMISSIONS.LOYALTY_EDIT, PERMISSIONS.LOYALTY_MANAGE);
    if (response) return response;

    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;

    const { data, error } = await validateRequest(req, loyaltyMilestoneUpdateSchema);
    if (error) return error;

    try {
        const tier = await prisma.loyaltyMilestone.update({
            where: { id },
            data,
            include: { _count: { select: { awards: true } } },
        });
        return NextResponse.json(tier);
    } catch (e) {
        return handleApiError(e, "Failed to update milestone");
    }
}

// DELETE /api/loyalty/milestones/[id] — removing a tier also drops its award
// rows (cascade); customers keep the bonus points already granted.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAnyPermission(PERMISSIONS.LOYALTY_DELETE, PERMISSIONS.LOYALTY_MANAGE);
    if (response) return response;

    const { id, error } = await parseIdParam(params);
    if (error) return error;

    try {
        await prisma.loyaltyMilestone.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete milestone");
    }
}
