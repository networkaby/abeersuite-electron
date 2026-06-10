import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

type Params = { params: Promise<{ id: string }> };

const ticketStatusPatchSchema = z.object({
    label: z.string().trim().min(1).optional(),
    color: z.string().trim().min(1).optional(),
    order: z.coerce.number().int().nonnegative().optional(),
    isTerminal: z.boolean().optional(),
    isEntryPoint: z.boolean().optional(),
    workId: z.string().trim().optional().nullable(),
    actionLabel: z.string().optional().nullable(),
    warrantyScope: z.enum(["any", "warranty_only", "non_warranty_only"]).optional(),
});

export async function PATCH(req: Request, { params }: Params) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_STATUSES);
    if (response) return response;
    try {
        const { id } = await params;
        const { data, error } = await validateRequest(req, ticketStatusPatchSchema);
        if (error) return error;
        const body = data;

        const status = await prisma.ticketStatus.update({
            where: { id },
            data: {
                label: body.label !== undefined ? body.label : undefined,
                color: body.color !== undefined ? body.color : undefined,
                order: body.order !== undefined ? Number(body.order) : undefined,
                isTerminal: body.isTerminal !== undefined ? body.isTerminal : undefined,
                isEntryPoint: body.isEntryPoint !== undefined ? body.isEntryPoint : undefined,
                workId: "workId" in body ? (body.workId ?? null) : undefined,
                actionLabel: "actionLabel" in body ? (body.actionLabel ?? null) : undefined,
                warrantyScope: body.warrantyScope !== undefined ? body.warrantyScope : undefined,
            },
        });
        return NextResponse.json(status);
    } catch (e) {
        return handleApiError(e, "Failed to update status");
    }
}

export async function DELETE(_: Request, { params }: Params) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_STATUSES);
    if (response) return response;
    try {
        const { id } = await params;

        const inUse = await prisma.ticket.count({ where: { status: id } });
        if (inUse > 0) {
            return NextResponse.json(
                { error: `Cannot delete: ${inUse} ticket(s) currently use this status.` },
                { status: 400 }
            );
        }

        // Transitions cascade automatically via ON DELETE CASCADE
        await prisma.ticketStatus.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete status");
    }
}
