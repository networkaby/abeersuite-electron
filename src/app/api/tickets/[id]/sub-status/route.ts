import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

// PATCH /api/tickets/[id]/sub-status
// Body: { subStatusId: string, note?: string }
export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const userId = Number((session.user as { id?: string }).id);
        const userRole = (session.user as { role?: string }).role ?? "";

        const { id } = await params;
        const ticketId = Number(id);
        const body = await req.json();
        const { subStatusId, note, visibility } = body as {
            subStatusId: string;
            note?: string;
            visibility?: "internal" | "public";
        };

        const subStatus = await prisma.ticketSubStatus.findUnique({
            where: { id: subStatusId },
        });
        if (!subStatus) {
            return NextResponse.json({ error: "Sub-status not found" }, { status: 404 });
        }

        // Admin (R1) can set any sub-status regardless of allowedRoles
        if (userRole !== "R1" && subStatus.allowedRoles.length > 0 && !subStatus.allowedRoles.includes(userRole)) {
            return NextResponse.json({ error: "Your role cannot set this sub-status" }, { status: 403 });
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
                visibility: visibility === "public" ? "public" : "internal",
                userId,
            },
        });

        // If main status auto-changed, log that too
        if (triggerStatusId) {
            await prisma.ticketLog.create({
                data: {
                    ticketId,
                    status: triggerStatusId,
                    note: `Auto-advanced by: ${subStatus.label}`,
                    userId,
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
        console.error("[sub-status PATCH]", error);
        return NextResponse.json({ error: "Failed to update sub-status" }, { status: 500 });
    }
}
