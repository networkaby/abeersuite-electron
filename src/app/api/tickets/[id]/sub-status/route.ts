import { prisma } from "@/shared/lib/prisma/prismaClient";
import { createSystemInboxNotifications } from "@/modules/message/lib/inbox";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";

const subStatusUpdateSchema = z.object({
    subStatusId: z.string().trim().min(1, "Sub-status is required"),
    note: z.string().optional(),
    visibility: z.enum(["INTERNAL", "PUBLIC"]).optional(),
});

// PATCH /api/tickets/[id]/sub-status
// Body: { subStatusId: string, note?: string, visibility?: string }
// Returns { ok: true } or { ok: false, requiresAssignment: true, role, candidates }
export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const sessionUser = session.user as { 
            id?: string; 
            role?: string; 
            roles?: string[]; 
            permissions?: string[];
        };
        const userId = Number(sessionUser.id ?? 0);
        const userRoles: string[] = sessionUser.role ? [sessionUser.role] : [];
        const permissions = sessionUser.permissions ?? [];

        const { id } = await params;
        const ticketId = Number(id);
        const { data, error } = await validateRequest(req, subStatusUpdateSchema);
        if (error) return error;
        const { subStatusId, note, visibility } = data;

        const subStatus = await prisma.ticketSubStatus.findUnique({
            where: { id: subStatusId },
        });
        if (!subStatus) {
            return NextResponse.json({ error: "Sub-status not found" }, { status: 404 });
        }

        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            include: { device: { include: { account: { include: { person: true, company: true } } } } },
        });
        if (!ticket) {
            return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
        }

        // Auth: Admin bypasses allowedRoles.
        // Primary owner and active secondary owners can also update sub-status.
        const isAdmin = permissions.includes("admin:bypass");
        const isPrimaryOwner = ticket.primaryOwnerId === userId;

        if (!isAdmin) {
            // Check if secondary participant
            const isSecondary = await prisma.ticketParticipant.findFirst({
                where: { ticketId, userId, removedAt: null },
                select: { id: true },
            });

            const roleAllowed = subStatus.allowedRoles.length === 0 || userRoles.some(r => subStatus.allowedRoles.includes(r));
            const hasAccess = isPrimaryOwner || !!isSecondary || roleAllowed;

            if (!hasAccess) {
                return NextResponse.json({ error: "Your role cannot set this sub-status" }, { status: 403 });
            }
        }

        // Capture previous sub-status before update (needed for auto-revert)
        const prevSubStatusId = ticket.subStatusId;

        const triggerMap = (subStatus.triggerMap ?? {}) as Record<string, string>;
        const triggerStatusId = triggerMap[ticket.status] ?? null;
        const newMainStatus = triggerStatusId ?? ticket.status;
        const newSubStatusId = triggerStatusId ? null : subStatusId;
        const fallbackStatus = await prisma.ticketStatus.findUnique({
            where: { id: newMainStatus },
            select: { label: true, notifyRoles: true },
        });

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

        // ── Handoff: auto-assign secondary if handoffRole set ──────────────────
        if (subStatus.handoffRole && newSubStatusId) {
            const candidates = await prisma.user.findMany({
                where: { role: subStatus.handoffRole },
                select: { id: true, name: true, role: true },
            });

            if (candidates.length === 1) {
                // Auto-assign the only candidate
                try {
                    await prisma.ticketParticipant.create({
                        data: {
                            ticketId,
                            userId: candidates[0].id,
                            addedById: userId,
                            addedForRole: subStatus.handoffRole,
                            addedBySubStatusId: subStatusId,
                        },
                    });
                    await prisma.ticketLog.create({
                        data: {
                            ticketId,
                            status: newMainStatus,
                            note: `Auto-assigned ${candidates[0].name} as secondary (${subStatus.handoffRole})`,
                            userId,
                        },
                    });
                } catch {
                    // Already a participant — ignore duplicate
                }
            } else if (candidates.length > 1) {
                // Return picker prompt — ticket update already committed
                return NextResponse.json({
                    ok: false,
                    requiresAssignment: true,
                    role: subStatus.handoffRole,
                    subStatusId,
                    candidates,
                });
            }
            // candidates.length === 0: skip silently
        }

        const effectiveNotifyRoles = subStatus.notifyRoles.length > 0
            ? subStatus.notifyRoles
            : (fallbackStatus?.notifyRoles ?? []);

        if (effectiveNotifyRoles.length > 0) {
            await createSystemInboxNotifications({
                roleIds: effectiveNotifyRoles,
                actorUserId: userId,
                title: `Ticket #${ticketId} updated to ${subStatus.label}`,
                body: triggerStatusId && fallbackStatus
                    ? `Auto-advanced to ${fallbackStatus.label}. Next action is with ${effectiveNotifyRoles.join(", ")}.`
                    : `Next action is with ${effectiveNotifyRoles.join(", ")}.`,
                link: `/office/repairing/tickets/${ticketId}`,
            });
        }

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("[sub-status PATCH]", error);
        return NextResponse.json({ error: "Failed to update sub-status" }, { status: 500 });
    }
}
