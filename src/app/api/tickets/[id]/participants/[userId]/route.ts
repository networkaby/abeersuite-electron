import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions";
import { auth } from "@/auth";

export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string; userId: string }> }
) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sessionUser = session.user as { id?: string; permissions?: string[] };
    const callerId = Number(sessionUser.id ?? 0);
    const callerPermissions = sessionUser.permissions ?? [];

    const { id, userId } = await params;
    const ticketId = Number(id);
    const targetUserId = Number(userId);

    // Allow self-removal without permission check; otherwise require manage-participants
    const isSelfRemoval = callerId === targetUserId;
    if (!isSelfRemoval && !callerPermissions.includes("tickets:manage-participants")) {
        // Re-use requirePermission for the error response shape
        const { response } = await requirePermission("tickets:manage-participants");
        return response!;
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
                userId: callerId,
            },
        });

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to remove participant" }, { status: 500 });
    }
}
