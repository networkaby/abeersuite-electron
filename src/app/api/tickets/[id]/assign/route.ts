import { prisma, prismaWhereSaved } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";

const assignSchema = z.object({
    action: z.enum(["claim", "pass", "reject"]),
    toUserId: z.coerce.number().int().positive().optional(),
});

// Assignment is SEAT-based now (Ticket.assignedPositionId) — the person's primary
// Position holds the ticket, so it transfers automatically on staff change. Resolve
// a user to that seat.
async function seatOf(userId: number): Promise<string | null> {
    const up = await prisma.userPosition.findFirst({ where: { userId }, select: { positionId: true } });
    return up?.positionId ?? null;
}

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    // Open to all staff by design — owner's decision (2026-10-18).
    const { user, response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const ticketId = Number(id);
    const { data, error } = await validateRequest(req, assignSchema);
    if (error) return error;
    const { action, toUserId } = data;

    try {
        const ticket = await prismaWhereSaved().ticket.findUnique({
            where: { id: ticketId },
            select: {
                id: true,
                status: true,
                assignedPositionId: true,
                ticketStatus: { select: { isTerminal: true } },
            },
        });

        if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
        if (ticket.ticketStatus.isTerminal) {
            return NextResponse.json({ error: "Cannot assign a closed ticket" }, { status: 409 });
        }
        const author = await buildActorSnapshot(user.id);

        if (action === "claim") {
            if (ticket.assignedPositionId !== null) {
                return NextResponse.json({ error: "Ticket already has an owner" }, { status: 409 });
            }
            const seat = await seatOf(user.id);
            // Optimistic lock: update only if still unassigned
            const res = await prisma.ticket.updateMany({
                where: { id: ticketId, assignedPositionId: null },
                data: { assignedPositionId: seat },
            });
            if (res.count === 0) {
                return NextResponse.json({ error: "Ticket was claimed by someone else" }, { status: 409 });
            }
            const me = await prisma.user.findUnique({ where: { id: user.id }, select: { name: true } });
            await prisma.ticketLog.create({
                data: { ticketId, status: ticket.status, note: `Claimed by ${me?.name ?? `user ${user.id}`}`, author },
            });
            return NextResponse.json({ ok: true, assignedPositionId: seat });
        }

        if (action === "pass") {
            if (!toUserId) return NextResponse.json({ error: "toUserId required for pass" }, { status: 400 });
            const toUser = await prisma.user.findUnique({ where: { id: toUserId }, select: { id: true, name: true } });
            if (!toUser) return NextResponse.json({ error: "Target user not found" }, { status: 404 });
            const seat = await seatOf(toUserId);
            await prisma.ticket.update({ where: { id: ticketId }, data: { assignedPositionId: seat } });
            await prisma.ticketLog.create({
                data: { ticketId, status: ticket.status, note: `Passed to ${toUser.name}`, author },
            });
            return NextResponse.json({ ok: true, assignedPositionId: seat, toUser });
        }

        if (action === "reject") {
            await prisma.ticket.update({ where: { id: ticketId }, data: { assignedPositionId: null } });
            await prisma.ticketLog.create({
                data: { ticketId, status: ticket.status, note: `Returned to unassigned pool`, author },
            });
            return NextResponse.json({ ok: true, assignedPositionId: null });
        }
    } catch (e) {
        return handleApiError(e, "Failed to update assignment");
    }
}
