import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/lib/auth-guard";
import { z } from "zod";

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
    } catch {
        return NextResponse.json({ error: "Failed to fetch statuses" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission("settings:statuses");
    if (response) return response;
    try {
        const parsed = ticketStatusSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid status payload" }, { status: 400 });
        }
        const body = parsed.data;

        // Generate next opaque ID: find highest numeric suffix among existing S* IDs
        const existing = await prisma.ticketStatus.findMany({ select: { id: true } });
        const maxN = existing.reduce((max, s) => {
            const n = parseInt(s.id.replace(/\D/g, ""), 10);
            return isNaN(n) ? max : Math.max(max, n);
        }, 0);
        const newId = `S${maxN + 1}`;

        const status = await prisma.ticketStatus.create({
            data: {
                id:           newId,
                label:        body.label,
                color:        body.color       ?? "bg-gray-100 text-gray-600",
                order:        body.order       ?? maxN + 1,
                isTerminal:   body.isTerminal  ?? false,
                allowedRoles: body.allowedRoles ?? [],
                notifyRoles:  body.notifyRoles  ?? [],
                actionLabel:  body.actionLabel  ?? null,
                warrantyScope: body.warrantyScope ?? "any",
                pipelineId:   body.pipelineId ?? null,
            },
        });
        return NextResponse.json(status, { status: 201 });
    } catch {
        return NextResponse.json({ error: "Failed to create status" }, { status: 500 });
    }
}
