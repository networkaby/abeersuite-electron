import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";
import { Priority } from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import { statusHasWorkflowRole } from "@/shared/lib/constants/workflow";
import { resolvedUserFromSession } from "@/shared/lib/auth/permissions";
import { passesWorkGate } from "@/modules/repairing/lib/workGate";
import { findEntryWorker } from "@/modules/repairing/lib/entryWorker";
import { autoAdvance } from "@/modules/repairing/lib/autoAdvance";
import { reconcileParentFromChild } from "@/modules/repairing/lib/spawnChild";
import { listAllChildren } from "@/modules/repairing/lib/childEntities";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { selectPrimaryPhone } from "@/shared/lib/prisma/fragments";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";

const ticketUpdateSchema = z.object({
    status: z.string().trim().optional(),
    priority: z.nativeEnum(Priority).optional(),
    notes: z.string().optional(),
    accessInfo: z.string().optional(),
    estimatedCost: z.preprocess(
        (value) => value === "" ? null : value,
        z.union([z.coerce.number().nonnegative(), z.null()]).optional()
    ),
    escalated: z.boolean().optional(),
    escalatedAt: z.string().optional().nullable(),
    expectedReturn: z.string().optional().nullable(),
    receivedBackAt: z.string().optional().nullable(),
    externalRef: z.string().optional(),
    serviceCenterId: z.union([z.coerce.number().int().positive(), z.literal(""), z.null()]).optional(),
    isWarranty: z.boolean().optional(),
    warrantyRef: z.string().optional(),
    purchaseDate: z.string().optional().nullable(),
    logNote: z.string().optional(),
    visibility: z.enum(["INTERNAL", "PUBLIC"]).optional(),
    // Undo/back restore: when present, skip auto-entry-worker and set this directly.
    restoreWorkerId: z.string().nullable().optional(),
});

export async function GET(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        // TODO(rbac): scope filtering removed — any authenticated staff can read any ticket.

        const ticket = await prisma.ticket.findFirst({
            where: {
                id: Number(id),
            },
            include: {
                repair: {
                    include: {
                        device: {
                            include: {
                                account: {
                                    select: {
                                        id: true, name: true,
                                        person: { select: { phones: selectPrimaryPhone } },
                                        company: { select: { phones: selectPrimaryPhone } },
                                    },
                                },
                            },
                        },
                        serviceCenter: true,
                    },
                },
                ticketStatus: {
                    include: {
                        fromTransitions: {
                            include: { to: { select: { id: true, label: true, color: true, isTerminal: true } } },
                            orderBy: { toStatusId: "asc" },
                        },
                    },
                },
                ticketWorker: { select: { id: true, label: true, color: true, actionLabel: true, work: { select: { label: true, color: true, successLabel: true, failLabel: true, startLabel: true, prompt: true, successPopup: true, failPopup: true, args: true } }, successWorker: { select: { id: true, label: true } }, failWorker: { select: { id: true, label: true } }, successStatus: { select: { id: true, label: true } }, failStatus: { select: { id: true, label: true } } } },
                pipeline:        { select: { id: true, label: true, color: true } },
                // Spawned child sub-pipelines (5th power) are gathered across ALL entity
                // tables below via listAllChildren — not just the Ticket self-relation.
                parent: { select: { id: true } },
                participants: {
                    where: { removedAt: null },
                    include: { user: { select: { id: true, name: true, role: true } } },
                    orderBy: { createdAt: "asc" },
                },
                logs: {
                    // author is a JSON ActorSnapshot on the log row itself (no User FK).
                    include: {
                        ticketStatus:    { select: { label: true, color: true } },
                        ticketWorker: { select: { label: true, color: true } },
                    },
                    orderBy: { createdAt: "desc" },
                },
            },
        });

        if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });

        // Spawned children across every flavour (single Ticket query).
        const children = await listAllChildren(ticket.id);

        // Flatten the repair detail back to top level so the repair UI keeps its old
        // flat shape (ticket.device / ticket.warrantyStatus / ticket.serviceCenter / …).
        const repair = ticket.repair;
        const acct = repair?.device?.account ?? null;
        const device = repair?.device
            ? { ...repair.device, account: acct ? { ...acct, phone: acct.person?.phones?.[0]?.phone ?? acct.company?.phones?.[0]?.phone ?? null } : null }
            : null;

        return NextResponse.json({
            ...ticket,
            ...(repair ?? {}),
            device,
            serviceCenter: repair?.serviceCenter ?? null,
            children,
        });
    } catch (e) {
        return handleApiError(e, "Failed to fetch ticket");
    }
}

export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const resolvedUser = resolvedUserFromSession(session);
        const userId = resolvedUser.id;

        const { id } = await params;
        const scopedTicket = await prisma.ticket.findUnique({
            where: { id: Number(id) },
            select: { id: true, status: true, context: true },
        });
        if (!scopedTicket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });

        const { data, error } = await validateRequest(req, ticketUpdateSchema);

        if (error) return error;
        const body = data;

        // Work-permission gate on status changes: a target status carrying a gated
        // Work requires that permission. Statuses with no/ungated Work are open.
        // Also pull the status' customer-announcement config (auto public message on entry).
        let targetStatus: { label: string; announceOnEntry: boolean; etaText: string | null } | null = null;
        if (body.status) {
            const found = await prisma.ticketStatus.findUnique({
                where: { id: body.status },
                select: { label: true, announceOnEntry: true, etaText: true, work: { select: { permissionId: true } } },
            });
            if (!passesWorkGate(resolvedUser, found?.work ?? null)) {
                return NextResponse.json({ error: "You don't have permission for this work" }, { status: 403 });
            }
            if (found) targetStatus = { label: found.label, announceOnEntry: found.announceOnEntry, etaText: found.etaText };
        }

        const author = await buildActorSnapshot(userId);

        // Repair-detail fields live on TicketRepair now; core fields on Ticket.
        const repairData = {
            ...(body.accessInfo !== undefined   && { accessInfo: body.accessInfo }),
            ...(body.estimatedCost !== undefined && { estimatedCost: body.estimatedCost ? Number(body.estimatedCost) : null }),
            ...(body.escalated !== undefined    && { escalated: body.escalated }),
            ...(body.escalatedAt !== undefined  && { escalatedAt: body.escalatedAt ? new Date(body.escalatedAt) : null }),
            ...(body.expectedReturn !== undefined && { expectedReturn: body.expectedReturn ? new Date(body.expectedReturn) : null }),
            ...(body.receivedBackAt !== undefined && { receivedBackAt: body.receivedBackAt ? new Date(body.receivedBackAt) : null }),
            ...(body.externalRef !== undefined  && { externalRef: body.externalRef || null }),
            ...(body.serviceCenterId !== undefined && { serviceCenterId: body.serviceCenterId ? Number(body.serviceCenterId) : null }),
            ...(body.isWarranty !== undefined   && { isWarranty: Boolean(body.isWarranty) }),
            ...(body.warrantyRef !== undefined  && { warrantyRef: body.warrantyRef || null }),
            ...(body.purchaseDate !== undefined && { purchaseDate: body.purchaseDate ? new Date(body.purchaseDate) : null }),
        };

        const ticket = await prisma.ticket.update({
            where: { id: Number(id) },
            data: {
                ...(body.status !== undefined   && { status: body.status }),
                ...(body.priority !== undefined && { priority: body.priority }),
                ...(body.notes !== undefined    && { notes: body.notes }),
                ...(Object.keys(repairData).length ? { repair: { update: repairData } } : {}),
            },
        });

        // Lock the latest service slip once the device is physically sent — i.e.
        // the ticket enters an `atServiceCentre` status (S65 "Sent To Service").
        // A locked slip can no longer be edited; a later re-escalation to S62
        // starts a fresh slip. Skipped on undo/back (that's not a real send).
        if (body.status && !("restoreWorkerId" in body) && statusHasWorkflowRole("atServiceCentre", body.status)) {
            const ctx =
                scopedTicket.context && typeof scopedTicket.context === "object" && !Array.isArray(scopedTicket.context)
                    ? (scopedTicket.context as Record<string, unknown>)
                    : {};
            const list = Array.isArray(ctx.shippingSlips) ? [...(ctx.shippingSlips as Record<string, unknown>[])] : [];
            const last = list[list.length - 1];
            if (last && !last.locked) {
                const locked = { ...last, locked: true, sentAt: new Date().toISOString() };
                list[list.length - 1] = locked;
                await prisma.ticket.update({
                    where: { id: ticket.id },
                    data: { context: { ...ctx, shippingSlip: locked, shippingSlips: list } as Prisma.InputJsonValue },
                });
            }
        }

        if (body.status) {
            if ("restoreWorkerId" in body) {
                // Undo/back: restore the exact previous (status, worker) pair.
                // Skip auto-entry-worker — we're going to a specific known state.
                await prisma.ticket.update({
                    where: { id: ticket.id },
                    data: { workerId: body.restoreWorkerId ?? null, wakeAt: null, retryCount: 0, retryKeyId: null },
                });
                await prisma.ticketLog.create({
                    data: {
                        ticketId:   ticket.id,
                        status:     body.status,
                        workerId: body.restoreWorkerId ?? null,
                        note:       body.logNote || null,
                        visibility: body.visibility === "PUBLIC" ? "PUBLIC" : "INTERNAL",
                        author,
                    },
                });
            } else {
                // Normal status change: log it, then auto-apply entry worker.
                await prisma.ticketLog.create({
                    data: {
                        ticketId:   ticket.id,
                        status:     body.status,
                        note:       body.logNote || null,
                        visibility: body.visibility === "PUBLIC" ? "PUBLIC" : "INTERNAL",
                        author,
                    },
                });

                // Auto-apply entry worker for the new status (same logic as ticket creation).
                const entrySub = await findEntryWorker(body.status);
                if (entrySub) {
                    await prisma.ticket.update({
                        where: { id: ticket.id },
                        data: { workerId: entrySub.id, wakeAt: null, retryCount: 0, retryKeyId: null },
                    });
                    await prisma.ticketLog.create({
                        data: { ticketId: ticket.id, status: body.status, workerId: entrySub.id, note: `Entered: ${entrySub.label}`, author },
                    });
                } else {
                    // No entry worker configured — clear current worker so stale work doesn't linger.
                    await prisma.ticket.update({ where: { id: ticket.id }, data: { workerId: null, wakeAt: null, retryCount: 0, retryKeyId: null } });
                }
                // If the entry worker is an Action (auto Work), run it + chain (best-effort).
                if (entrySub) await autoAdvance(ticket.id, userId).catch(() => { /* never blocks the status change */ });
            }
            // Customer-facing announcement: if the entered status opts in, auto-post a
            // PUBLIC timeline note "<label> is started and will take <etaText>". Skipped
            // on undo/back (a revert shouldn't re-announce the stage to the customer).
            if (!("restoreWorkerId" in body) && targetStatus?.announceOnEntry) {
                const eta = targetStatus.etaText?.trim();
                await prisma.ticketLog.create({
                    data: {
                        ticketId:   ticket.id,
                        status:     body.status,
                        note:       `${targetStatus.label} is started${eta ? ` and will take ${eta}` : ""}`,
                        visibility: "PUBLIC",
                        author,
                    },
                });
            }
            // If this change took a CHILD ticket onto a worker that signals its
            // parent, reconcile the parent (fire its Success / Unsuccess route).
            await reconcileParentFromChild(ticket.id, userId).catch(() => { /* best-effort */ });
        }

        return NextResponse.json(ticket);
    } catch (e) {
        return handleApiError(e, "Failed to update ticket");
    }
}
