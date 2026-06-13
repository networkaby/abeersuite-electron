import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { generateNextOpaqueId } from "@/shared/lib/api";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { labelColorSchema } from "@/shared/lib/schemas/commonSchemas";
import { Prisma } from "@/generated/prisma/client";

const workerSchema = labelColorSchema.extend({
    publicLabel: z.string().trim().optional().nullable(),
    workId: z.string().trim().optional().nullable(),
    order: z.coerce.number().int().nonnegative().optional(),
    statusId: z.string().trim().nullable().optional(),
    triggerMap: z.record(z.string(), z.string()).optional(),
    actionLabel: z.string().optional().nullable(),
    warrantyScope: z.enum(["any", "warranty_only", "non_warranty_only"]).optional(),
    successWorkerId: z.string().trim().optional().nullable(),
    failWorkerId: z.string().trim().optional().nullable(),
    autoRevertOnClear: z.boolean().optional(),
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
    pipelineId: z.string().optional().nullable(),
});

// GET /api/workers?statusId=S3&pipelineId=P1
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { searchParams } = new URL(req.url);
        const statusId = searchParams.get("statusId");
        const pipelineId = searchParams.get("pipelineId");

        const all = await prisma.ticketWorker.findMany({
            where: pipelineId ? { pipelineId } : undefined,
            orderBy: { order: "asc" },
            include: {
                fromTransitions: {
                    include: { to: { select: { id: true, label: true, color: true } } },
                },
            },
        });

        const result = statusId ? all.filter((ss) => ss.statusId === statusId) : all;

        return NextResponse.json(result);
    } catch (e) {
        return handleApiError(e, "Failed to fetch workers");
    }
}

// POST /api/workers
export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_STATUSES);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, workerSchema);
        if (error) return error;
        const body = data;

        const { id: newId, n: nextOrder } = await generateNextOpaqueId(prisma.ticketWorker, "SS");

        const created = await prisma.ticketWorker.create({
            data: {
                id: newId,
                label: body.label,
                publicLabel: body.publicLabel ?? null,
                color: body.color ?? "bg-gray-100 text-gray-600",
                workId: body.workId ?? null,
                order: body.order ?? nextOrder,
                statusId:           body.statusId ?? null,
                triggerMap:         body.triggerMap ?? {},
                actionLabel:        body.actionLabel ?? null,
                warrantyScope:      body.warrantyScope ?? "any",
                successWorkerId: body.successWorkerId ?? null,
                failWorkerId:    body.failWorkerId ?? null,
                autoRevertOnClear:  body.autoRevertOnClear ?? true,
                retrySchedule:      body.retrySchedule ?? [],
                spawnPipelineId:    body.spawnPipelineId ?? null,
                parentSignal:       body.parentSignal ?? null,
                actions:            (body.actions ?? []) as unknown as Prisma.InputJsonValue,
                pipelineId:         body.pipelineId ?? null,
            },
        });

        return NextResponse.json(created, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create worker");
    }
}
