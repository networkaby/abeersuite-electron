import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { z } from "zod";

const patchSchema = z.object({
    label: z.string().trim().min(1).optional(),
    color: z.string().trim().optional(),
    order: z.coerce.number().int().nonnegative().optional(),
    gated: z.boolean().optional(),
});

async function mintGroupPermission(id: string, label: string): Promise<string> {
    const permissionId = `workgroup:${id}`;
    await prisma.permission.upsert({
        where:  { id: permissionId },
        update: { label: `Work Group: ${label}`, module: "tickets" },
        create: { id: permissionId, label: `Work Group: ${label}`, module: "tickets", description: `See ${label} tickets in the Work Inbox.` },
    });
    return permissionId;
}

// PATCH /api/work-groups/[id]
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { id } = await params;
        const { data, error } = await validateRequest(req, patchSchema);
        if (error) return error;

        const group = await prisma.workGroup.findUnique({ where: { id } });
        if (!group) return NextResponse.json({ error: "Work group not found" }, { status: 404 });

        const label = data.label ?? group.label;
        let permissionId = group.permissionId;
        if (data.gated !== undefined) {
            // Gate transition: mint/link the permission, or detach it (row kept).
            permissionId = data.gated ? await mintGroupPermission(id, label) : null;
        } else if (data.label && group.permissionId) {
            // Keep the existing permission label in sync with the group label.
            await mintGroupPermission(id, label);
        }

        const updated = await prisma.workGroup.update({
            where: { id },
            data: {
                ...(data.label !== undefined && { label: data.label }),
                ...(data.color !== undefined && { color: data.color }),
                ...(data.order !== undefined && { order: data.order }),
                permissionId,
            },
        });
        return NextResponse.json(updated);
    } catch (e) {
        return handleApiError(e, "Failed to update work group");
    }
}

// DELETE /api/work-groups/[id] — works in the group keep existing; only their
// membership rows are removed (WorkGroupWork.workGroupId is onDelete: Cascade, so
// the join rows drop while the Work rows themselves are untouched).
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { id } = await params;
        await prisma.workGroup.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete work group");
    }
}
