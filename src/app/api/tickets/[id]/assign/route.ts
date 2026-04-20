import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission, isAdmin } from "@/lib/auth-guard";

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { user, response } = await requirePermission("tickets:assign");
    if (response) return response;

    const { id } = await params;
    const ticketId = Number(id);
    const body: { action: "claim" | "pass" | "reject"; toUserId?: number } = await req.json();

    const { action, toUserId } = body;

    if (!["claim", "pass", "reject"].includes(action)) {
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    try {
        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            select: {
                id: true,
                primaryOwnerId: true,
                primaryOwner: { select: { id: true, name: true, managerId: true } },
                ticketStatus: { select: { isTerminal: true } },
            },
        });

        if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
        if (ticket.ticketStatus.isTerminal) {
            return NextResponse.json({ error: "Cannot assign a closed ticket" }, { status: 409 });
        }

        // Check caller has authority over the ticket (for pass/reject)
        const callerIsOwner = ticket.primaryOwnerId === user.id;
        const callerIsAdmin = isAdmin(user);
        const callerIsDirectManager = ticket.primaryOwner?.managerId === user.id;
        const hasAuthority = callerIsOwner || callerIsAdmin || callerIsDirectManager;

        if (action === "claim") {
            if (ticket.primaryOwnerId !== null) {
                return NextResponse.json({ error: "Ticket already has an owner" }, { status: 409 });
            }
            // Optimistic lock: update only if still unassigned
            try {
                await prisma.ticket.update({
                    where: { id: ticketId, primaryOwnerId: null },
                    data: { primaryOwnerId: user.id },
                });
            } catch {
                return NextResponse.json({ error: "Ticket was claimed by someone else" }, { status: 409 });
            }
            await prisma.ticketLog.create({
                data: {
                    ticketId,
                    status: ticket.ticketStatus ? (await prisma.ticket.findUnique({ where: { id: ticketId }, select: { status: true } }))!.status : "S1",
                    note: `Claimed by ${user.id}`,
                    userId: user.id,
                },
            });
            const updated = await prisma.ticket.findUnique({
                where: { id: ticketId },
                select: { primaryOwnerId: true, primaryOwner: { select: { id: true, name: true } } },
            });
            return NextResponse.json({ ok: true, primaryOwnerId: updated?.primaryOwnerId, primaryOwner: updated?.primaryOwner });
        }

        if (action === "pass") {
            if (!toUserId) return NextResponse.json({ error: "toUserId required for pass" }, { status: 400 });
            if (!hasAuthority) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
            const toUser = await prisma.user.findUnique({ where: { id: toUserId }, select: { id: true, name: true } });
            if (!toUser) return NextResponse.json({ error: "Target user not found" }, { status: 404 });
            const currentStatus = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { status: true } });
            await prisma.ticket.update({ where: { id: ticketId }, data: { primaryOwnerId: toUserId } });
            await prisma.ticketLog.create({
                data: {
                    ticketId,
                    status: currentStatus!.status,
                    note: `Passed to ${toUser.name}`,
                    userId: user.id,
                },
            });
            return NextResponse.json({ ok: true, primaryOwnerId: toUserId, primaryOwner: toUser });
        }

        if (action === "reject") {
            if (!hasAuthority) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
            const currentStatus = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { status: true } });
            await prisma.ticket.update({ where: { id: ticketId }, data: { primaryOwnerId: null } });
            await prisma.ticketLog.create({
                data: {
                    ticketId,
                    status: currentStatus!.status,
                    note: `Returned to unassigned pool`,
                    userId: user.id,
                },
            });
            return NextResponse.json({ ok: true, primaryOwnerId: null });
        }
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to update assignment" }, { status: 500 });
    }
}
