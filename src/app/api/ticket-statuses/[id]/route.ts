import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

type Params = { params: Promise<{ id: string }> };

const ticketStatusPatchSchema = z.object({
    label: z.string().trim().min(1).optional(),
    color: z.string().trim().min(1).optional(),
    order: z.coerce.number().int().nonnegative().optional(),
    isTerminal: z.boolean().optional(),
    isEntryPoint: z.boolean().optional(),
    startWorkerId: z.string().trim().nullable().optional(),
    workId: z.string().trim().optional().nullable(),
    actionLabel: z.string().optional().nullable(),
    warrantyScope: z.enum(["any", "warranty_only", "non_warranty_only"]).optional(),
    leavePrompt: z.string().optional().nullable(),
    announceOnEntry: z.boolean().optional(),
    etaText: z.string().optional().nullable(),
    waTemplate: z.string().trim().max(40).optional().nullable(),
    emailTemplate: z.string().trim().max(40).optional().nullable(),
    resolveTimeHours: z.coerce.number().int().nonnegative().nullable().optional(),
    resolveGroupId: z.string().trim().optional().nullable(),
    autoMoveAfterDays: z.coerce.number().int().min(1).max(365).nullable().optional(),
    autoMoveToId: z.string().trim().optional().nullable(),
});

export async function PATCH(req: Request, { params }: Params) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { id } = await params;
        const { data, error } = await validateRequest(req, ticketStatusPatchSchema);
        if (error) return error;
        const body = data;

        // A chosen start worker must actually be applicable to this status.
        if ("startWorkerId" in body && body.startWorkerId) {
            const sub = await prisma.ticketWorker.findUnique({
                where: { id: body.startWorkerId },
                select: { statusId: true },
            });
            if (!sub || sub.statusId !== id) {
                return NextResponse.json(
                    { error: "That worker isn't applicable to this status." },
                    { status: 422 }
                );
            }
        }

        // Auto-move target: another status on the same pipeline.
        if (body.autoMoveToId) {
            const [self, target] = await Promise.all([
                prisma.ticketStatus.findUnique({ where: { id }, select: { pipelineId: true } }),
                prisma.ticketStatus.findUnique({ where: { id: body.autoMoveToId }, select: { pipelineId: true } }),
            ]);
            if (!self || !target || body.autoMoveToId === id || target.pipelineId !== self.pipelineId) {
                return NextResponse.json({ error: "Auto-move must go to another status of this pipeline." }, { status: 422 });
            }
        }

        const status = await prisma.ticketStatus.update({
            where: { id },
            data: {
                label: body.label !== undefined ? body.label : undefined,
                color: body.color !== undefined ? body.color : undefined,
                order: body.order !== undefined ? Number(body.order) : undefined,
                isTerminal: body.isTerminal !== undefined ? body.isTerminal : undefined,
                isEntryPoint: body.isEntryPoint !== undefined ? body.isEntryPoint : undefined,
                startWorkerId: "startWorkerId" in body ? (body.startWorkerId ?? null) : undefined,
                workId: "workId" in body ? (body.workId ?? null) : undefined,
                actionLabel: "actionLabel" in body ? (body.actionLabel ?? null) : undefined,
                warrantyScope: body.warrantyScope !== undefined ? body.warrantyScope : undefined,
                leavePrompt: "leavePrompt" in body ? (body.leavePrompt ?? null) : undefined,
                announceOnEntry: body.announceOnEntry !== undefined ? body.announceOnEntry : undefined,
                etaText: "etaText" in body ? (body.etaText ?? null) : undefined,
                waTemplate: "waTemplate" in body ? (body.waTemplate || null) : undefined,
                emailTemplate: "emailTemplate" in body ? (body.emailTemplate || null) : undefined,
                resolveTimeHours: "resolveTimeHours" in body ? (body.resolveTimeHours ?? null) : undefined,
                resolveGroupId: "resolveGroupId" in body ? (body.resolveGroupId ?? null) : undefined,
                autoMoveAfterDays: "autoMoveAfterDays" in body ? (body.autoMoveAfterDays ?? null) : undefined,
                autoMoveToId: "autoMoveToId" in body ? (body.autoMoveToId || null) : undefined,
            },
        });
        return NextResponse.json(status);
    } catch (e) {
        return handleApiError(e, "Failed to update status");
    }
}

export async function DELETE(_: Request, { params }: Params) {
    const { response } = await requireAuth();
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
