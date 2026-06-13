import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { z } from "zod";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const patchSchema = z.object({
    label: z.string().trim().min(1).optional(),
    color: z.string().trim().optional(),
    order: z.coerce.number().int().nonnegative().optional(),
});

// PATCH /api/work-groups/[id]
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_STATUSES);
    if (response) return response;
    try {
        const { id } = await params;
        const { data, error } = await validateRequest(req, patchSchema);
        if (error) return error;
        const updated = await prisma.workGroup.update({
            where: { id },
            data: {
                ...(data.label !== undefined && { label: data.label }),
                ...(data.color !== undefined && { color: data.color }),
                ...(data.order !== undefined && { order: data.order }),
            },
        });
        return NextResponse.json(updated);
    } catch (e) {
        return handleApiError(e, "Failed to update work group");
    }
}

// DELETE /api/work-groups/[id] — works in the group keep existing; their groupId is
// nulled (onDelete: SetNull).
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_STATUSES);
    if (response) return response;
    try {
        const { id } = await params;
        await prisma.workGroup.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete work group");
    }
}
