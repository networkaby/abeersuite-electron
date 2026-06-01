import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { loyaltyEarnRuleUpdateSchema } from "@/shared/lib/schemas/loyaltySchemas";

// PATCH /api/loyalty/earn-rules/[id] — edit multiplier / enabled flag.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.LOYALTY_MANAGE);
    if (response) return response;

    const id = Number((await params).id);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

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
    const { response } = await requirePermission(PERMISSIONS.LOYALTY_MANAGE);
    if (response) return response;

    const id = Number((await params).id);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    try {
        await prisma.loyaltyEarnRule.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete earn rule");
    }
}
