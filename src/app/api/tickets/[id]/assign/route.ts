import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission, isAdmin } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { buildTicketReadScopeWhere } from "@/shared/lib/format/ticketScope";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const assignSchema = z.object({
    action: z.enum(["claim", "pass", "reject"]),
    toUserId: z.coerce.number().int().positive().optional(),
});

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { user, response } = await requirePermission(PERMISSIONS.TICKETS_ASSIGN);
    if (response) return response;

    const { id } = await params;
    const ticketId = Number(id);
    const { data, error } = await validateRequest(req, assignSchema);
    if (error) return error;
    const body = data;

    const { action, toUserId } = body;

    try {
        const scopeWhere = buildTicketReadScopeWhere(user);
        const ticket = await prisma.ticket.findFirst({
            where: {
                id: ticketId,
                ...(scopeWhere ?? {}),
            },
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
            const updated = await prisma.ticket.findUnique({
                where: { id: ticketId },
                select: { status: true, primaryOwnerId: true, primaryOwner: { select: { id: true, name: true } } },
            });
            await prisma.ticketLog.create({
                data: {
                    ticketId,
                    status: updated?.status ?? "S1",
                    note: `Claimed by ${updated?.primaryOwner?.name ?? `user ${user.id}`}`,
                    userId: user.id,
                },
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
    } catch (e) {
        return handleApiError(e, "Failed to update assignment");
    }
}
