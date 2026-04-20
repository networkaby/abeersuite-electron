import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth, hasPermission } from "@/lib/auth-guard";

export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string; userId: string }> }
) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const { id, userId } = await params;
    const ticketId = Number(id);
    const targetUserId = Number(userId);

    const isSelfRemoval = user.id === targetUserId;
    if (!isSelfRemoval && !hasPermission(user, "tickets:manage-participants")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
        const participant = await prisma.ticketParticipant.findFirst({
            where: { ticketId, userId: targetUserId, removedAt: null },
            select: { id: true, user: { select: { name: true } } },
        });
        if (!participant) return NextResponse.json({ error: "Active participant not found" }, { status: 404 });

        await prisma.ticketParticipant.update({
            where: { id: participant.id },
            data: { removedAt: new Date() },
        });

        const currentStatus = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { status: true } });
        await prisma.ticketLog.create({
            data: {
                ticketId,
                status: currentStatus!.status,
                note: `Secondary owner removed: ${participant.user.name}`,
                userId: user.id,
            },
        });

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to remove participant" }, { status: 500 });
    }
}
