import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { passesWorkGate } from "@/modules/repairing/lib/workGate";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

const subStatusUpdateSchema = z.object({
    subStatusId: z.string().trim().min(1, "Sub-status is required"),
    note: z.string().optional(),
    visibility: z.enum(["INTERNAL", "PUBLIC"]).optional(),
});

// PATCH /api/tickets/[id]/sub-status
// Body: { subStatusId: string, note?: string, visibility?: string }
// Returns { ok: true }
export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { user, response } = await requireAuth();
        if (response) return response;
        const userId = user.id;

        const { id } = await params;
        const ticketId = Number(id);
        const { data, error } = await validateRequest(req, subStatusUpdateSchema);
        if (error) return error;
        const { subStatusId, note, visibility } = data;

        const subStatus = await prisma.ticketSubStatus.findUnique({
            where: { id: subStatusId },
            include: { work: { select: { permissionId: true } } },
        });
        if (!subStatus) {
            return NextResponse.json({ error: "Sub-status not found" }, { status: 404 });
        }
        // Work-permission gate: only staff holding the sub-status' Work permission
        // may set it (ungated works are open to anyone; admin:bypass always passes).
        if (!passesWorkGate(user, subStatus.work)) {
            return NextResponse.json({ error: "You don't have permission for this work" }, { status: 403 });
        }

        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            include: { device: { include: { account: { include: { person: true, company: true } } } } },
        });
        if (!ticket) {
            return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
        }

        // Capture previous sub-status before update (needed for auto-revert)
        const prevSubStatusId = ticket.subStatusId;

        const triggerMap = (subStatus.triggerMap ?? {}) as Record<string, string>;
        const triggerStatusId = triggerMap[ticket.status] ?? null;
        const newMainStatus = triggerStatusId ?? ticket.status;
        const newSubStatusId = triggerStatusId ? null : subStatusId;

        // ── Transaction: update ticket + auto-revert old participants ───────────
        await prisma.$transaction(async (tx) => {
            // 1. Update ticket
            await tx.ticket.update({
                where: { id: ticketId },
                data: {
                    subStatusId: newSubStatusId,
                    status: newMainStatus,
                    updatedAt: new Date(),
                },
            });

            // 2. Auto-revert participants added by the outgoing sub-status
            if (prevSubStatusId && prevSubStatusId !== subStatusId) {
                const prevSub = await tx.ticketSubStatus.findUnique({
                    where: { id: prevSubStatusId },
                    select: { autoRevertOnClear: true },
                });
                if (prevSub?.autoRevertOnClear) {
                    const toRevert = await tx.ticketParticipant.findMany({
                        where: { ticketId, addedBySubStatusId: prevSubStatusId, removedAt: null },
                        select: { id: true, user: { select: { name: true } } },
                    });
                    for (const p of toRevert) {
                        await tx.ticketParticipant.update({
                            where: { id: p.id },
                            data: { removedAt: new Date(), removedBySubStatusId: subStatusId },
                        });
                        await tx.ticketLog.create({
                            data: {
                                ticketId,
                                status: newMainStatus,
                                note: `Secondary owner auto-removed: ${p.user.name} (sub-status changed)`,
                                userId,
                            },
                        });
                    }
                }
            }

            // 3. Log the sub-status change
            await tx.ticketLog.create({
                data: {
                    ticketId,
                    status: ticket.status,
                    subStatusId,
                    note: note || null,
                    visibility: visibility === "PUBLIC" ? "PUBLIC" : "INTERNAL",
                    userId,
                },
            });

            // 4. Log auto-advance if triggered
            if (triggerStatusId) {
                await tx.ticketLog.create({
                    data: {
                        ticketId,
                        status: triggerStatusId,
                        note: `Auto-advanced by: ${subStatus.label}`,
                        userId,
                    },
                });
            }
        });

        // TODO(rbac): handoffRole auto-assignment removed (it looked staff up by the
        // legacy User.role). Re-add Position-based handoff when RBAC is re-wired.
        // TODO(notify): sub-status notifications detached — re-add later, decoupled.

        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to update sub-status");
    }
}
