import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

// PATCH /api/tickets/[id]/sub-status
// Body: { subStatusId: string, note?: string, changedBy: number }
export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const ticketId = Number(id);
        const body = await req.json();
        const { subStatusId, note, changedBy } = body as {
            subStatusId: string;
            note?: string;
            changedBy: number;
        };

        const subStatus = await prisma.ticketSubStatus.findUnique({
            where: { id: subStatusId },
        });
        if (!subStatus) {
            return NextResponse.json({ error: "Sub-status not found" }, { status: 404 });
        }

        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            include: { device: { include: { customer: true } } },
        });
        if (!ticket) {
            return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
        }

        // Look up trigger for the ticket's CURRENT main status
        const triggerMap = (subStatus.triggerMap ?? {}) as Record<string, string>;
        const triggerStatusId = triggerMap[ticket.status] ?? null;
        const newMainStatus = triggerStatusId ?? ticket.status;

        // Update ticket: set sub-status, clear it if status auto-advances
        await prisma.ticket.update({
            where: { id: ticketId },
            data: {
                subStatusId: triggerStatusId ? null : subStatusId,
                status: newMainStatus,
                updatedAt: new Date(),
            },
        });

        // Log the sub-status change
        await prisma.ticketLog.create({
            data: {
                ticketId,
                status: ticket.status,
                subStatusId,
                note: note || null,
                userId: Number(changedBy),
            },
        });

        // If main status auto-changed, log that too
        if (triggerStatusId) {
            await prisma.ticketLog.create({
                data: {
                    ticketId,
                    status: triggerStatusId,
                    note: `Auto-advanced by: ${subStatus.label}`,
                    userId: Number(changedBy),
                },
            });
        }

        // Notify the relevant roles
        if (subStatus.notifyRoles.length > 0) {
            const usersToNotify = await prisma.user.findMany({
                where: { role: { in: subStatus.notifyRoles } },
                select: { id: true },
            });

            const deviceLabel = `${ticket.device.brand} ${ticket.device.model}`;
            const message = `Ticket #${ticketId} (${deviceLabel}): ${subStatus.label}`;

            if (usersToNotify.length > 0) {
                await prisma.notification.createMany({
                    data: usersToNotify.map((u) => ({
                        userId: u.id,
                        ticketId,
                        message,
                        type: "sub_status",
                    })),
                });
            }
        }

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to update sub-status" }, { status: 500 });
    }
}
