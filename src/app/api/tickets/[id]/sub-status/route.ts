import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { passesWorkGate } from "@/modules/repairing/lib/workGate";
import { findEntrySubStatus } from "@/modules/repairing/lib/entrySubStatus";
import { spawnChild, reconcileParentFromChild } from "@/modules/repairing/lib/spawnChild";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

const subStatusUpdateSchema = z.object({
    subStatusId: z.string().trim().min(1, "Sub-status is required"),
    note: z.string().optional(),
    visibility: z.enum(["INTERNAL", "PUBLIC"]).optional(),
    // Set by Success / Unsuccess on the Work Inbox — stamps the outgoing work as
    // "done" with its outcome so it lands in the Finished list.
    outcome: z.enum(["success", "unsuccess"]).optional(),
});

// ── Hybrid retry schedule helpers ──────────────────────────────────────────────
// A waiting sub-status carries retrySchedule: an ordered list of phases that runs
// densest-first (e.g. every 15 min ×4, then every 1 day ×5). Attempt 1 is immediate;
// attempts 2..Σtimes are spaced by the phase that contains them.
type RetryPhase = { unit: string; every: number; times: number };

function parseSchedule(raw: unknown): RetryPhase[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((p): p is RetryPhase =>
            !!p && typeof p === "object"
            && typeof (p as RetryPhase).unit === "string"
            && Number((p as RetryPhase).every) > 0
            && Number((p as RetryPhase).times) > 0)
        .map((p) => ({ unit: p.unit, every: Number(p.every), times: Number(p.times) }));
}

// The phase whose cumulative attempt-range contains attempt k, or null if k is
// past the schedule (→ give up).
function phaseForAttempt(phases: RetryPhase[], k: number): RetryPhase | null {
    let acc = 0;
    for (const p of phases) { acc += p.times; if (k <= acc) return p; }
    return null;
}

// Now + (every × unit), calendar-correct for month/year (not 30/365-day approximations).
function addInterval(unit: string, every: number): Date {
    const d = new Date();
    switch (unit) {
        case "minute": d.setMinutes(d.getMinutes() + every); break;
        case "hour":   d.setHours(d.getHours() + every); break;
        case "day":    d.setDate(d.getDate() + every); break;
        case "week":   d.setDate(d.getDate() + every * 7); break;
        case "month":  d.setMonth(d.getMonth() + every); break;
        case "year":   d.setFullYear(d.getFullYear() + every); break;
        default:       d.setMinutes(d.getMinutes() + every);
    }
    return d;
}

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
        const { subStatusId, note, visibility, outcome } = data;

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

        const triggerMapOf = (s: { triggerMap?: unknown } | null) =>
            (s?.triggerMap ?? {}) as Record<string, string>;

        // ── Hybrid retry schedule resolution ───────────────────────────────────
        // The retry schedule lives on the sub-status being ACTED ON (the one we're
        // leaving). An Unsuccess on a scheduled sub-status means "this attempt
        // failed" → keep the ticket ON that sub-status and schedule the next attempt
        // (overriding the fail-route ✗→, which is only honoured for non-scheduled
        // subs), or give up to its exhausted target once the schedule runs out.
        // wakeAt = now + the interval of the phase the failure count falls in,
        // densest first → the ticket drops into the Waiting tab. Arriving at a
        // scheduled sub WITHOUT a failure leaves wakeAt null → the first attempt is
        // due now. retryCount = failures so far, keyed by the sub-status so the
        // calling loop and parts loop count independently.
        const currentSub = prevSubStatusId
            ? (prevSubStatusId === subStatusId
                ? subStatus
                : await prisma.ticketSubStatus.findUnique({
                    where: { id: prevSubStatusId },
                    select: { id: true, label: true, retrySchedule: true, failSubStatusId: true },
                }))
            : null;
        const currentPhases = parseSchedule(currentSub?.retrySchedule);
        let landingSubStatusId: string = subStatusId;
        let wakeAt: Date | null = null;
        let retryCount = 0;
        let retryKeyId: string | null = null;
        let exhaustedFrom: string | null = null;
        if (outcome === "unsuccess" && currentSub && currentPhases.length > 0) {
            // Failed attempt on a scheduled sub → schedule the next attempt on it.
            const carried = ticket.retryKeyId === currentSub.id ? ticket.retryCount : 0;
            const fails = carried + 1;
            const phase = phaseForAttempt(currentPhases, fails);
            if (phase) {
                landingSubStatusId = currentSub.id;          // stay put, snoozed until due
                retryCount = fails;
                retryKeyId = currentSub.id;
                wakeAt = addInterval(phase.unit, phase.every);
            } else if (currentSub.failSubStatusId) {
                landingSubStatusId = currentSub.failSubStatusId;  // schedule exhausted → the unsuccess route (give up)
                exhaustedFrom = currentSub.label;
            } else {
                landingSubStatusId = currentSub.id;          // exhausted, no target → stay, stop re-arming
                retryCount = carried;
                retryKeyId = currentSub.id;
            }
        } else {
            // Arriving at a scheduled sub (no failure) → attempt 1 is due now; seed the
            // counter key so the first Unsuccess counts from here.
            const targetPhases = parseSchedule(subStatus.retrySchedule);
            if (targetPhases.length > 0) {
                retryKeyId = subStatus.id;
                retryCount = ticket.retryKeyId === subStatus.id ? ticket.retryCount : 0;
            }
        }

        // The sub-status we actually land on (the target, or the give-up redirect).
        // Its triggerMap drives any auto-advance to a new STATUS — so a give-up
        // target that is a shim (e.g. → Closed) transitions in this same request.
        const landingSub = landingSubStatusId === subStatusId
            ? subStatus
            : await prisma.ticketSubStatus.findUnique({
                where: { id: landingSubStatusId },
                select: { id: true, label: true, triggerMap: true },
            });
        const triggerStatusId = triggerMapOf(landingSub)[ticket.status] ?? null;
        const newMainStatus = triggerStatusId ?? ticket.status;
        // On auto-advance to a new status, apply that status's entry sub-status
        // (mirrors ticket create + PUT status change). Without this the ticket
        // would land in the new status with no work sub-status / inbox item.
        const entrySub = triggerStatusId ? await findEntrySubStatus(triggerStatusId) : null;
        const newSubStatusId = triggerStatusId ? (entrySub?.id ?? null) : landingSubStatusId;
        // Auto-advancing past a waiting state clears the snooze/retry runtime.
        if (triggerStatusId) { wakeAt = null; retryCount = 0; retryKeyId = null; }

        // ── Transaction: update ticket + auto-revert old participants ───────────
        await prisma.$transaction(async (tx) => {
            // 1. Update ticket (incl. snooze/retry runtime — wakeAt drives the
            //    Work Inbox "Waiting" bucket; retryCount/retryKeyId bound the loop)
            await tx.ticket.update({
                where: { id: ticketId },
                data: {
                    subStatusId: newSubStatusId,
                    status: newMainStatus,
                    wakeAt,
                    retryCount,
                    retryKeyId,
                    updatedAt: new Date(),
                },
            });

            // 1b. Give-up stamp — retry limit reached, routed off the waiting loop.
            if (exhaustedFrom) {
                await tx.ticketLog.create({
                    data: {
                        ticketId,
                        status: newMainStatus,
                        subStatusId: newSubStatusId,
                        note: `Retry limit reached on "${exhaustedFrom}" — routed onward`,
                        userId,
                    },
                });
            }

            // 2. Auto-revert participants added by the outgoing sub-status. Compare
            //    against the ACTUAL landing sub (newSubStatusId), not the requested
            //    target — a snoozed retry stays put (prev === landing) and must NOT revert.
            if (prevSubStatusId && prevSubStatusId !== newSubStatusId) {
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
                            data: { removedAt: new Date(), removedBySubStatusId: newSubStatusId },
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

            // 3. Log the sub-status change (when an outcome is recorded, the note rides
            //    on the completion stamp below instead, to avoid a duplicate line).
            await tx.ticketLog.create({
                data: {
                    ticketId,
                    status: ticket.status,
                    subStatusId: newSubStatusId,
                    note: outcome ? null : (note || null),
                    visibility: visibility === "PUBLIC" ? "PUBLIC" : "INTERNAL",
                    userId,
                },
            });

            // 3b. Completion stamp — marks the OUTGOING work (prevSubStatusId) done with
            //     its outcome. The Work Inbox "Finished" list reads these (joins the
            //     sub-status' Work, parses Success/Unsuccess from the note).
            if (outcome && prevSubStatusId) {
                await tx.ticketLog.create({
                    data: {
                        ticketId,
                        status: ticket.status,
                        subStatusId: prevSubStatusId,
                        note: `Work done · ${outcome === "success" ? "Success" : "Unsuccess"}${note ? " — " + note : ""}`,
                        userId,
                    },
                });
            }

            // 4. Log auto-advance if triggered (+ the entry sub-status it landed in)
            if (triggerStatusId) {
                await tx.ticketLog.create({
                    data: {
                        ticketId,
                        status: triggerStatusId,
                        note: `Auto-advanced by: ${landingSub?.label ?? subStatus.label}`,
                        userId,
                    },
                });
                if (entrySub) {
                    await tx.ticketLog.create({
                        data: {
                            ticketId,
                            status: triggerStatusId,
                            subStatusId: entrySub.id,
                            note: `Entered: ${entrySub.label}`,
                            userId,
                        },
                    });
                }
            }
        });

        // 5th power — if the landing sub-status spawns a child pipeline, open the
        // child on whatever entity that pipeline rides (ticket/task/deal/…), via the
        // CHILD_ENTITIES registry (idempotent; best-effort so it never blocks the move).
        if (newSubStatusId) {
            const landing = await prisma.ticketSubStatus.findUnique({
                where: { id: newSubStatusId },
                select: { spawnPipelineId: true },
            });
            if (landing?.spawnPipelineId) {
                await spawnChild({
                    parentId: ticketId,
                    parentStatus: newMainStatus,
                    parentSubStatusId: newSubStatusId,
                    spawnPipelineId: landing.spawnPipelineId,
                    deviceId: ticket.deviceId,
                    userId,
                }).catch(() => { /* spawn failure must not fail the move */ });
            }
        }

        // If this move took a CHILD ticket onto a sub-status that signals its parent,
        // reconcile the parent (fire its Success / Unsuccess route).
        await reconcileParentFromChild(ticketId, userId).catch(() => { /* best-effort */ });

        // TODO(rbac): handoffRole auto-assignment removed (it looked staff up by the
        // legacy User.role). Re-add Position-based handoff when RBAC is re-wired.
        // TODO(notify): sub-status notifications detached — re-add later, decoupled.

        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to update sub-status");
    }
}

// DELETE /api/tickets/[id]/sub-status
// Clears the current sub-status ("Close" the ask). Open to any authenticated
// staff (permission gating deferred to the later permission pass). Logs the
// closure so it lands in the ticket activity.
export async function DELETE(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { user, response } = await requireAuth();
        if (response) return response;

        const { id } = await params;
        const ticketId = Number(id);

        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            include: { ticketSubStatus: { select: { label: true } } },
        });
        if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
        if (!ticket.subStatusId) return NextResponse.json({ ok: true }); // already clear

        const label = ticket.ticketSubStatus?.label ?? "Sub-status";
        await prisma.$transaction(async (tx) => {
            await tx.ticket.update({
                where: { id: ticketId },
                data: { subStatusId: null, updatedAt: new Date() },
            });
            await tx.ticketLog.create({
                data: {
                    ticketId,
                    status: ticket.status,
                    note: `✓ ${label} closed — information acknowledged`,
                    userId: user.id,
                },
            });
        });

        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to close sub-status");
    }
}
