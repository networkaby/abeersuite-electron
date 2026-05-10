import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { generateNextOpaqueId } from "@/shared/lib/api";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

const ticketStatusSchema = z.object({
    label: z.string().trim().min(1, "Label is required"),
    color: z.string().trim().min(1).optional(),
    order: z.coerce.number().int().nonnegative().optional(),
    isTerminal: z.boolean().optional(),
    allowedRoles: z.array(z.string().trim()).optional(),
    notifyRoles: z.array(z.string().trim()).optional(),
    actionLabel: z.string().optional().nullable(),
    warrantyScope: z.enum(["any", "warranty_only", "non_warranty_only"]).optional(),
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
    const { response } = await requirePermission("settings:statuses");
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
                allowedRoles: body.allowedRoles ?? [],
                notifyRoles:  body.notifyRoles  ?? [],
                actionLabel:  body.actionLabel  ?? null,
                warrantyScope: body.warrantyScope ?? "any",
                pipelineId:   body.pipelineId ?? null,
            },
        });
        return NextResponse.json(status, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create status");
    }
}
