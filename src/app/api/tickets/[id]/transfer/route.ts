import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";

const transferSchema = z.object({
    targetPipelineId: z.string().trim().min(1),
    targetStatusId: z.string().trim().optional(),
    note: z.string().optional(),
});

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const sessionUser = session.user as {
            id?: string;
            permissions?: string[];
        };
        const userId = Number(sessionUser.id);
        const permissions = sessionUser.permissions ?? [];

        if (!permissions.includes("tickets:transfer") && !permissions.includes("admin:bypass")) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const { id } = await params;
        const { data, error } = await validateRequest(req, transferSchema);
        if (error) return error;
        const { targetPipelineId, targetStatusId, note } = data;

        const ticket = await prisma.ticket.findUnique({
            where: { id: Number(id) },
            include: {
                pipeline: { select: { label: true } },
                ticketStatus: { select: { isTerminal: true } },
            },
        });
        if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
        if (ticket.ticketStatus.isTerminal) {
            return NextResponse.json({ error: "Cannot transfer a closed ticket" }, { status: 400 });
        }
        if (ticket.pipelineId === targetPipelineId) {
            return NextResponse.json({ error: "Ticket is already in this pipeline" }, { status: 400 });
        }

        const targetPipeline = await prisma.pipeline.findUnique({
            where: { id: targetPipelineId },
            select: { id: true, label: true },
        });
        if (!targetPipeline) return NextResponse.json({ error: "Target pipeline not found" }, { status: 404 });

        // Resolve landing status: provided > entry point > first non-terminal status
        let landingStatusId = targetStatusId;

        if (!landingStatusId) {
            const entryPoint = await prisma.ticketStatus.findFirst({
                where: { pipelineId: targetPipelineId, isEntryPoint: true },
                select: { id: true },
            });
            landingStatusId = entryPoint?.id;
        }

        if (!landingStatusId) {
            const firstStatus = await prisma.ticketStatus.findFirst({
                where: { pipelineId: targetPipelineId, isTerminal: false },
                orderBy: { order: "asc" },
                select: { id: true },
            });
            landingStatusId = firstStatus?.id;
        }

        if (!landingStatusId) {
            return NextResponse.json({ error: "Target pipeline has no valid statuses" }, { status: 400 });
        }

        const sourcePipelineLabel = ticket.pipeline?.label ?? "Unknown Pipeline";
        const transferNote = note
            ? `Transferred from ${sourcePipelineLabel} to ${targetPipeline.label}. ${note}`
            : `Transferred from ${sourcePipelineLabel} to ${targetPipeline.label}`;

        await prisma.$transaction([
            prisma.ticket.update({
                where: { id: Number(id) },
                data: {
                    pipelineId: targetPipelineId,
                    status: landingStatusId,
                    subStatusId: null,
                },
            }),
            prisma.ticketLog.create({
                data: {
                    ticketId: Number(id),
                    status: landingStatusId,
                    note: transferNote,
                    visibility: "INTERNAL",
                    userId,
                },
            }),
        ]);

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to transfer ticket" }, { status: 500 });
    }
}

// Returns available pipelines + statuses for the transfer modal
export async function GET(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { id } = await params;
        const ticket = await prisma.ticket.findUnique({
            where: { id: Number(id) },
            select: { pipelineId: true },
        });
        if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });

        const pipelines = await prisma.pipeline.findMany({
            where: { isActive: true, id: { not: ticket.pipelineId ?? undefined } },
            orderBy: { order: "asc" },
            select: {
                id: true,
                label: true,
                color: true,
                statuses: {
                    where: { isTerminal: false },
                    orderBy: { order: "asc" },
                    select: { id: true, label: true, isEntryPoint: true },
                },
            },
        });

        return NextResponse.json(pipelines);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to fetch pipelines" }, { status: 500 });
    }
}
