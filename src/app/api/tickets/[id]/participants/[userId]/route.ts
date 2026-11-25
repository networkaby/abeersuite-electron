import { prisma, prismaWhereSaved } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";

export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string; userId: string }> }
) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const { id, userId } = await params;
    const ticketId = Number(id);
    const targetUserId = Number(userId);

    // Repair permission layer is being rebuilt (blank canvas) — ungated for now.
    try {
        const participant = await prismaWhereSaved().ticketParticipant.findFirst({
            where: { ticketId, userId: targetUserId, removedAt: null },
            select: { id: true, user: { select: { name: true } } },
        });
        if (!participant) return NextResponse.json({ error: "Active participant not found" }, { status: 404 });

        await prisma.ticketParticipant.update({
            where: { id: participant.id },
            data: { removedAt: new Date() },
        });

        const currentStatus = await prismaWhereSaved().ticket.findUnique({ where: { id: ticketId }, select: { status: true } });
        await prisma.ticketLog.create({
            data: {
                ticketId,
                status: currentStatus!.status,
                note: `Secondary owner removed: ${participant.user.name}`,
                author: await buildActorSnapshot(user.id),
            },
        });

        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to remove participant");
    }
}
