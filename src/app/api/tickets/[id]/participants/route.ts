import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { auth } from "@/auth";
import { z } from "zod";
import { prismaUniqueError } from "@/shared/lib/api";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

const participantSchema = z.object({
    userId: z.coerce.number().int().positive("userId required"),
    addedForRole: z.string().trim().optional(),
    addedByWorkerId: z.string().trim().optional(),
});

export async function GET(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const ticketId = Number(id);

    try {
        const scopedTicket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            select: { id: true },
        });
        if (!scopedTicket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });

        const participants = await prisma.ticketParticipant.findMany({
            where: { ticketId, removedAt: null },
            include: { user: { select: { id: true, name: true, role: true } } },
            orderBy: { createdAt: "asc" },
        });
        return NextResponse.json(participants);
    } catch (e) {
        return handleApiError(e, "Failed to fetch participants");
    }
}

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    // TODO(rbac): was requirePermission(TICKETS_MANAGE_PARTICIPANTS) — open to all staff.
    const { user, response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const ticketId = Number(id);
    const { data, error } = await validateRequest(req, participantSchema);
    if (error) return error;
    const body = data;

    try {
        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            select: { ticketStatus: { select: { isTerminal: true } } },
        });
        if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
        if (ticket.ticketStatus.isTerminal) {
            return NextResponse.json({ error: "Cannot add participant to a closed ticket" }, { status: 409 });
        }

        // TODO(rbac): addedForRole validation removed (checked the legacy User.role).
        const targetUser = await prisma.user.findUnique({
            where: { id: body.userId },
            select: { id: true, name: true },
        });
        if (!targetUser) return NextResponse.json({ error: "User not found" }, { status: 404 });

        const participant = await prisma.ticketParticipant.create({
            data: {
                ticketId,
                userId: body.userId,
                addedById: user.id,
                addedForRole: body.addedForRole ?? null,
                addedByWorkerId: body.addedByWorkerId ?? null,
            },
            include: { user: { select: { id: true, name: true, role: true } } },
        });

        const currentStatus = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { status: true } });
        await prisma.ticketLog.create({
            data: {
                ticketId,
                status: currentStatus!.status,
                note: `Secondary owner added: ${targetUser.name}${body.addedForRole ? ` (${body.addedForRole})` : ""}`,
                userId: user.id,
            },
        });

        return NextResponse.json(participant, { status: 201 });
    } catch (e) {
        const conflict = prismaUniqueError(e, "User is already a participant on this ticket");
        if (conflict) return conflict;
        return handleApiError(e, "Failed to add participant");
    }
}
