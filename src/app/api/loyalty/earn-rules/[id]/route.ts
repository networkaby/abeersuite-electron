import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAnyPermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError, parseIdParam } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { loyaltyEarnRuleUpdateSchema } from "@/shared/lib/schemas/loyaltySchemas";

// PATCH /api/loyalty/earn-rules/[id] — edit multiplier / enabled flag.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAnyPermission(PERMISSIONS.LOYALTY_EDIT);
    if (response) return response;

    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;

    const { data, error } = await validateRequest(req, loyaltyEarnRuleUpdateSchema);
    if (error) return error;

    try {
        const rule = await prisma.loyaltyEarnRule.update({ where: { id }, data });
        return NextResponse.json(rule);
    } catch (e) {
        return handleApiError(e, "Failed to update earn rule");
    }
}

// DELETE /api/loyalty/earn-rules/[id]
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAnyPermission(PERMISSIONS.LOYALTY_DELETE);
    if (response) return response;

    const { id, error } = await parseIdParam(params);
    if (error) return error;

    try {
        await prisma.loyaltyEarnRule.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete earn rule");
    }
}
