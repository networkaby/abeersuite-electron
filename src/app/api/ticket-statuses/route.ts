import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { generateNextOpaqueId } from "@/shared/lib/api";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { labelColorSchema } from "@/shared/lib/schemas/commonSchemas";

const ticketStatusSchema = labelColorSchema.extend({
    order: z.coerce.number().int().nonnegative().optional(),
    isTerminal: z.boolean().optional(),
    workId: z.string().trim().optional().nullable(),
    actionLabel: z.string().optional().nullable(),
    warrantyScope: z.enum(["any", "warranty_only", "non_warranty_only"]).optional(),
    leavePrompt: z.string().optional().nullable(),
    announceOnEntry: z.boolean().optional(),
    etaText: z.string().optional().nullable(),
    resolveTimeHours: z.coerce.number().int().nonnegative().nullable().optional(),
    pipelineId: z.string().optional().nullable(),
});

// GET /api/ticket-statuses?pipelineId=P1
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { searchParams } = new URL(req.url);
        const pipelineId = searchParams.get("pipelineId");

        const statuses = await prisma.ticketStatus.findMany({
            where: pipelineId ? { pipelineId } : undefined,
            orderBy: { order: "asc" },
            include: {
                fromTransitions: {
                    include: { to: true },
                    orderBy: { toStatusId: "asc" },
                },
                _count: { select: { tickets: true } },
            },
        });
        return NextResponse.json(statuses);
    } catch (e) {
        return handleApiError(e, "Failed to fetch statuses");
    }
}

export async function POST(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, ticketStatusSchema);
        if (error) return error;
        const body = data;

        const { id: newId, n: nextOrder } = await generateNextOpaqueId(prisma.ticketStatus, "S");

        const status = await prisma.ticketStatus.create({
            data: {
                id:           newId,
                label:        body.label,
                color:        body.color       ?? "bg-gray-100 text-gray-600",
                order:        body.order       ?? nextOrder,
                isTerminal:   body.isTerminal  ?? false,
                workId:       body.workId ?? null,
                actionLabel:  body.actionLabel  ?? null,
                warrantyScope: body.warrantyScope ?? "any",
                leavePrompt:  body.leavePrompt ?? null,
                announceOnEntry: body.announceOnEntry ?? false,
                etaText:      body.etaText ?? null,
                resolveTimeHours: body.resolveTimeHours ?? null,
                pipelineId:   body.pipelineId ?? null,
            },
        });
        return NextResponse.json(status, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create status");
    }
}
