import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const subStatusPatchSchema = z.object({
    label: z.string().trim().min(1).optional(),
    color: z.string().trim().min(1).optional(),
    workId: z.string().trim().optional().nullable(),
    order: z.coerce.number().int().nonnegative().optional(),
    applicableStatusIds: z.array(z.string().trim()).optional(),
    triggerMap: z.record(z.string(), z.string()).optional(),
    actionLabel: z.string().optional().nullable(),
    warrantyScope: z.enum(["any", "warranty_only", "non_warranty_only"]).optional(),
    outcome: z.enum(["SUCCESS", "FAIL", "NEUTRAL"]).optional(),
    autoRevertOnClear: z.boolean().optional(),
    isEntryPoint: z.boolean().optional(),
});

// DELETE /api/sub-statuses/[id]
export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_STATUSES);
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
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_STATUSES);
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
                ...("workId"  in body                    && { workId: body.workId ?? null }),
                ...(body.order !== undefined              && { order: body.order }),
                ...(body.applicableStatusIds !== undefined && { applicableStatusIds: body.applicableStatusIds }),
                ...("triggerMap"         in body && { triggerMap:        body.triggerMap }),
                ...("actionLabel"        in body && { actionLabel:       body.actionLabel ?? null }),
                ...("warrantyScope"      in body && { warrantyScope:     body.warrantyScope }),
                ...("outcome"            in body && { outcome:           body.outcome }),
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
