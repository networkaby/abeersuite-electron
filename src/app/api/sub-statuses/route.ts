import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { generateNextOpaqueId } from "@/shared/lib/api";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { labelColorSchema } from "@/shared/lib/schemas/commonSchemas";

const subStatusSchema = labelColorSchema.extend({
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
    pipelineId: z.string().optional().nullable(),
});

// GET /api/sub-statuses?statusId=S3&pipelineId=P1
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { searchParams } = new URL(req.url);
        const statusId = searchParams.get("statusId");
        const pipelineId = searchParams.get("pipelineId");

        const all = await prisma.ticketSubStatus.findMany({
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
        return handleApiError(e, "Failed to fetch sub-statuses");
    }
}

// POST /api/sub-statuses
export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_STATUSES);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, subStatusSchema);
        if (error) return error;
        const body = data;

        const { id: newId, n: nextOrder } = await generateNextOpaqueId(prisma.ticketSubStatus, "SS");

        const created = await prisma.ticketSubStatus.create({
            data: {
                id: newId,
                label: body.label,
                color: body.color ?? "bg-gray-100 text-gray-600",
                workId: body.workId ?? null,
                order: body.order ?? nextOrder,
                statusId:           body.statusId ?? null,
                triggerMap:         body.triggerMap ?? {},
                actionLabel:        body.actionLabel ?? null,
                warrantyScope:      body.warrantyScope ?? "any",
                successSubStatusId: body.successSubStatusId ?? null,
                failSubStatusId:    body.failSubStatusId ?? null,
                autoRevertOnClear:  body.autoRevertOnClear ?? true,
                retrySchedule:      body.retrySchedule ?? [],
                exhaustedSubStatusId: body.exhaustedSubStatusId ?? null,
                pipelineId:         body.pipelineId ?? null,
            },
        });

        return NextResponse.json(created, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create sub-status");
    }
}
