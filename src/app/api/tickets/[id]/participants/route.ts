import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { auth } from "@/auth";

export async function GET(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const ticketId = Number(id);

    try {
        const participants = await prisma.ticketParticipant.findMany({
            where: { ticketId, removedAt: null },
            include: { user: { select: { id: true, name: true, role: true } } },
            orderBy: { createdAt: "asc" },
        });
        return NextResponse.json(participants);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to fetch participants" }, { status: 500 });
    }
}

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { user, response } = await requirePermission("tickets:manage-participants");
    if (response) return response;

    const { id } = await params;
    const ticketId = Number(id);
    const body: { userId: number; addedForRole?: string; addedBySubStatusId?: string } = await req.json();

    if (!body.userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

    try {
        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            select: { ticketStatus: { select: { isTerminal: true } } },
        });
        if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
        if (ticket.ticketStatus.isTerminal) {
            return NextResponse.json({ error: "Cannot add participant to a closed ticket" }, { status: 409 });
        }

        // Validate user exists and still has the required role if addedForRole specified
        const targetUser = await prisma.user.findUnique({
            where: { id: body.userId },
            select: { id: true, name: true, role: true, userRoles: { select: { roleId: true } } },
        });
        if (!targetUser) return NextResponse.json({ error: "User not found" }, { status: 404 });
        if (body.addedForRole) {
            const hasRole = targetUser.userRoles.some(r => r.roleId === body.addedForRole) || targetUser.role === body.addedForRole;
            if (!hasRole) return NextResponse.json({ error: "User no longer has the required role", code: "ROLE_MISMATCH" }, { status: 409 });
        }

        const participant = await prisma.ticketParticipant.create({
            data: {
                ticketId,
                userId: body.userId,
                addedById: user.id,
                addedForRole: body.addedForRole ?? null,
                addedBySubStatusId: body.addedBySubStatusId ?? null,
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
    } catch (error: unknown) {
        if ((error as { code?: string }).code === "P2002") {
            return NextResponse.json({ error: "User is already a participant on this ticket" }, { status: 409 });
        }
        console.error(error);
        return NextResponse.json({ error: "Failed to add participant" }, { status: 500 });
    }
}
