import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { pickDefined } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const patchSchema = z.object({
    label: z.string().trim().min(1).optional(),
    order: z.coerce.number().int().nonnegative().optional(),
});

// PATCH /api/sub-status-groups/[id]
export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_STATUSES);
    if (response) return response;
    try {
        const { id } = await params;
        const { data, error } = await validateRequest(req, patchSchema);
        if (error) return error;
        const body = data;
        const updated = await prisma.work.update({
            where: { id },
            data: pickDefined({
                label: body.label,
                order: body.order,
            }),
        });
        return NextResponse.json(updated);
    } catch (e) {
        return handleApiError(e, "Failed to update group");
    }
}

// DELETE /api/sub-status-groups/[id]
export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_STATUSES);
    if (response) return response;
    try {
        const { id } = await params;
        const inUse = await prisma.ticketSubStatus.count({ where: { workId: id } });
        if (inUse > 0) {
            return NextResponse.json(
                { error: `Cannot delete — ${inUse} sub-status(es) are assigned to this group.` },
                { status: 409 }
            );
        }
        await prisma.work.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete group");
    }
}
