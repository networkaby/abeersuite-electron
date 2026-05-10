import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

const subStatusPatchSchema = z.object({
    label: z.string().trim().min(1).optional(),
    color: z.string().trim().min(1).optional(),
    group: z.string().trim().optional().nullable(),
    groupId: z.string().trim().optional().nullable(),
    order: z.coerce.number().int().nonnegative().optional(),
    applicableStatusIds: z.array(z.string().trim()).optional(),
    allowedRoles: z.array(z.string().trim()).optional(),
    notifyRoles: z.array(z.string().trim()).optional(),
    triggerMap: z.record(z.string(), z.string()).optional(),
    actionLabel: z.string().optional().nullable(),
    warrantyScope: z.enum(["any", "warranty_only", "non_warranty_only"]).optional(),
    handoffRole: z.string().optional().nullable(),
    autoRevertOnClear: z.boolean().optional(),
    isEntryPoint: z.boolean().optional(),
});

// DELETE /api/sub-statuses/[id]
export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requirePermission("settings:statuses");
    if (response) return response;
    try {
        const { id } = await params;

        const inUse = await prisma.ticket.count({ where: { subStatusId: id } });
        if (inUse > 0) {
            return NextResponse.json(
                { error: `Cannot delete — ${inUse} ticket(s) currently use this sub-status.` },
                { status: 409 }
            );
        }

        await prisma.ticketSubStatus.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete sub-status");
    }
}

// PATCH /api/sub-statuses/[id]
export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requirePermission("settings:statuses");
    if (response) return response;
    try {
        const { id } = await params;
        const { data, error } = await validateRequest(req, subStatusPatchSchema);
        if (error) return error;
        const body = data;

        const updated = await prisma.ticketSubStatus.update({
            where: { id },
            data: {
                ...(body.label !== undefined              && { label: body.label }),
                ...(body.color !== undefined              && { color: body.color }),
                ...("group"   in body                    && { group: body.group ?? "" }),
                ...("groupId" in body                    && { groupId: body.groupId ?? null }),
                ...(body.order !== undefined              && { order: body.order }),
                ...(body.applicableStatusIds !== undefined && { applicableStatusIds: body.applicableStatusIds }),
                ...(body.allowedRoles !== undefined       && { allowedRoles: body.allowedRoles }),
                ...(body.notifyRoles !== undefined        && { notifyRoles: body.notifyRoles }),
                ...("triggerMap"         in body && { triggerMap:        body.triggerMap }),
                ...("actionLabel"        in body && { actionLabel:       body.actionLabel ?? null }),
                ...("warrantyScope"      in body && { warrantyScope:     body.warrantyScope }),
                ...("handoffRole"        in body && { handoffRole:       body.handoffRole ?? null }),
                ...("autoRevertOnClear"  in body && { autoRevertOnClear: body.autoRevertOnClear }),
            },
        });

        // Manage the null → id entry-point transition
        if (body.isEntryPoint === true) {
            await prisma.subStatusTransition.upsert({
                where: { fromSubStatusId_toSubStatusId: { fromSubStatusId: null as unknown as string, toSubStatusId: id } },
                update: {},
                create: { fromSubStatusId: null, toSubStatusId: id },
            });
        } else if (body.isEntryPoint === false) {
            await prisma.subStatusTransition.deleteMany({
                where: { fromSubStatusId: null, toSubStatusId: id },
            });
        }

        return NextResponse.json(updated);
    } catch (e) {
        return handleApiError(e, "Failed to update sub-status");
    }
}
