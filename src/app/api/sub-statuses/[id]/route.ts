import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const subStatusPatchSchema = z.object({
    label: z.string().trim().min(1).optional(),
    publicLabel: z.string().trim().optional().nullable(),
    color: z.string().trim().min(1).optional(),
    workId: z.string().trim().optional().nullable(),
    order: z.coerce.number().int().nonnegative().optional(),
    statusId: z.string().trim().nullable().optional(),
    triggerMap: z.record(z.string(), z.string()).optional(),
    actionLabel: z.string().optional().nullable(),
    warrantyScope: z.enum(["any", "warranty_only", "non_warranty_only"]).optional(),
    successSubStatusId: z.string().trim().optional().nullable(),
    failSubStatusId: z.string().trim().optional().nullable(),
    autoRevertOnClear: z.boolean().optional(),
    retrySchedule: z.array(z.object({
        unit: z.enum(["minute", "hour", "day", "week", "month", "year"]),
        every: z.coerce.number().int().positive(),
        times: z.coerce.number().int().positive(),
    })).optional(),
    exhaustedSubStatusId: z.string().trim().optional().nullable(),
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
                ...("publicLabel" in body                 && { publicLabel: body.publicLabel ?? null }),
                ...(body.color !== undefined              && { color: body.color }),
                ...("workId"  in body                    && { workId: body.workId ?? null }),
                ...(body.order !== undefined              && { order: body.order }),
                ...("statusId" in body && { statusId: body.statusId ?? null }),
                ...("triggerMap"         in body && { triggerMap:        body.triggerMap }),
                ...("actionLabel"        in body && { actionLabel:       body.actionLabel ?? null }),
                ...("warrantyScope"      in body && { warrantyScope:     body.warrantyScope }),
                ...("successSubStatusId" in body && { successSubStatusId: body.successSubStatusId ?? null }),
                ...("failSubStatusId"    in body && { failSubStatusId:    body.failSubStatusId ?? null }),
                ...("autoRevertOnClear"  in body && { autoRevertOnClear: body.autoRevertOnClear }),
                ...("retrySchedule"        in body && { retrySchedule:        body.retrySchedule ?? [] }),
                ...("exhaustedSubStatusId" in body && { exhaustedSubStatusId: body.exhaustedSubStatusId ?? null }),
            },
        });

        return NextResponse.json(updated);
    } catch (e) {
        return handleApiError(e, "Failed to update sub-status");
    }
}
