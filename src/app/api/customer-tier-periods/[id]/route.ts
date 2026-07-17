import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAnyPermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError, parseIdParam } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { customerTierPeriodUpdateSchema, isValidBracket } from "@/shared/lib/schemas/customerTierSchemas";

// PATCH /api/customer-tier-periods/[id] — edit title / bracket / enabled / order.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAnyPermission(PERMISSIONS.TIERS_EDIT);
    if (response) return response;

    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;

    const { data, error } = await validateRequest(req, customerTierPeriodUpdateSchema);
    if (error) return error;

    try {
        // The page patches one edge at a time, so the bracket can only be checked
        // against the stored row — a lone fromDay of 90 is fine or nonsense depending
        // on the toDay already saved.
        if (data.fromDay !== undefined || data.toDay !== undefined) {
            const current = await prisma.customerTierPeriod.findUnique({
                where: { id },
                select: { fromDay: true, toDay: true },
            });
            if (!current) return NextResponse.json({ error: "Period not found" }, { status: 404 });
            const fromDay = data.fromDay ?? current.fromDay;
            const toDay = data.toDay ?? current.toDay;
            if (!isValidBracket(fromDay, toDay)) {
                return NextResponse.json(
                    { error: `The bracket must end further back than it starts — ${fromDay} to ${toDay} days is empty.` },
                    { status: 400 },
                );
            }
        }
        const period = await prisma.customerTierPeriod.update({ where: { id }, data });
        return NextResponse.json(period);
    } catch (e) {
        return handleApiError(e, "Failed to update tier period");
    }
}

// DELETE /api/customer-tier-periods/[id] — remove a period and its levels
// (CustomerTier.period cascades on delete).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAnyPermission(PERMISSIONS.TIERS_DELETE);
    if (response) return response;

    const { id, error } = await parseIdParam(params);
    if (error) return error;

    try {
        await prisma.customerTierPeriod.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete tier period");
    }
}
