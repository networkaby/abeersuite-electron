import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { customerTierUpdateSchema } from "@/shared/lib/schemas/customerTierSchemas";

// PATCH /api/customer-tiers/[id] — edit name / threshold / % / enabled / order.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.CUSTOMERS_MANAGE);
    if (response) return response;

    const id = Number((await params).id);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const { data, error } = await validateRequest(req, customerTierUpdateSchema);
    if (error) return error;

    try {
        const tier = await prisma.customerTier.update({ where: { id }, data });
        return NextResponse.json(tier);
    } catch (e) {
        return handleApiError(e, "Failed to update customer tier");
    }
}

// DELETE /api/customer-tiers/[id] — remove a tier.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.CUSTOMERS_MANAGE);
    if (response) return response;

    const id = Number((await params).id);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    try {
        await prisma.customerTier.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete customer tier");
    }
}
