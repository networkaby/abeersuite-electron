import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { Prisma } from "@/generated/prisma/client";

const workerPatchSchema = z.object({
    label: z.string().trim().min(1).optional(),
    publicLabel: z.string().trim().optional().nullable(),
    color: z.string().trim().min(1).optional(),
    workId: z.string().trim().optional().nullable(),
    order: z.coerce.number().int().nonnegative().optional(),
    statusId: z.string().trim().nullable().optional(),
    triggerMap: z.record(z.string(), z.string()).optional(),
    actionLabel: z.string().optional().nullable(),
    warrantyScope: z.enum(["any", "warranty_only", "non_warranty_only"]).optional(),
    successWorkerId: z.string().trim().optional().nullable(),
    failWorkerId: z.string().trim().optional().nullable(),
    successStatusId: z.string().trim().optional().nullable(),
    failStatusId: z.string().trim().optional().nullable(),
    autoRevertOnClear: z.boolean().optional(),
    transitionNote: z.string().optional().nullable(),
    skipNoteOnEntry: z.boolean().optional(),
    requireNoteOnEntry: z.boolean().optional(),
    entryQuestion: z.string().optional().nullable(),
    retrySchedule: z.array(z.object({
        unit: z.enum(["minute", "hour", "day", "week", "month", "year"]),
        every: z.coerce.number().int().positive(),
        times: z.coerce.number().int().positive(),
    })).optional(),
    spawnPipelineId: z.string().trim().optional().nullable(),
    parentSignal: z.enum(["success", "fail"]).optional().nullable(),
    actions: z.array(z.object({
        type: z.string().trim().min(1),
        on: z.enum(["success", "fail", "always"]).optional(),
        config: z.record(z.string(), z.unknown()).optional(),
    })).optional(),
});

// DELETE /api/workers/[id]
export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { id } = await params;

        const inUse = await prisma.ticket.count({ where: { workerId: id } });
        if (inUse > 0) {
            return NextResponse.json(
                { error: `Cannot delete — ${inUse} ticket(s) currently use this worker.` },
                { status: 409 }
            );
        }

        await prisma.ticketWorker.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete worker");
    }
}

// PATCH /api/workers/[id]
export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { id } = await params;
        const { data, error } = await validateRequest(req, workerPatchSchema);
        if (error) return error;
        const body = data;

        const updated = await prisma.ticketWorker.update({
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
                ...("successWorkerId" in body && { successWorkerId: body.successWorkerId ?? null }),
                ...("failWorkerId"    in body && { failWorkerId:    body.failWorkerId ?? null }),
                ...("successStatusId" in body && { successStatusId: body.successStatusId ?? null }),
                ...("failStatusId"    in body && { failStatusId:    body.failStatusId ?? null }),
                ...("autoRevertOnClear"  in body && { autoRevertOnClear: body.autoRevertOnClear }),
                ...("transitionNote"     in body && { transitionNote:    body.transitionNote ?? null }),
                ...("skipNoteOnEntry"    in body && { skipNoteOnEntry:   body.skipNoteOnEntry }),
                ...("requireNoteOnEntry" in body && { requireNoteOnEntry: body.requireNoteOnEntry }),
                ...("entryQuestion"      in body && { entryQuestion:     body.entryQuestion ?? null }),
                ...("retrySchedule"        in body && { retrySchedule:        body.retrySchedule ?? [] }),
                ...("spawnPipelineId"      in body && { spawnPipelineId:      body.spawnPipelineId ?? null }),
                ...("parentSignal"         in body && { parentSignal:         body.parentSignal ?? null }),
                ...("actions"              in body && { actions:              (body.actions ?? []) as unknown as Prisma.InputJsonValue }),
            },
        });

        return NextResponse.json(updated);
    } catch (e) {
        return handleApiError(e, "Failed to update worker");
    }
}
