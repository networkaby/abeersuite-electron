import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { passesWorkGate } from "@/modules/repairing/lib/workGate";
import { findEntryWorker } from "@/modules/repairing/lib/entryWorker";
import { spawnChild, reconcileParentFromChild } from "@/modules/repairing/lib/spawnChild";
import { runWorkerActions } from "@/modules/repairing/lib/actions";
import { autoAdvance } from "@/modules/repairing/lib/autoAdvance";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";

const workerUpdateSchema = z.object({
    // The outcome target is EITHER a worker (route within/around the stage) OR a
    // statusId (jump straight to another stage, applying its entry worker). Exactly
    // one is required — the refine below enforces it.
    workerId: z.string().trim().min(1).optional(),
    statusId: z.string().trim().min(1).optional(),
    note: z.string().optional(),
    visibility: z.enum(["INTERNAL", "PUBLIC"]).optional(),
    // Set by Success / Unsuccess on the Work Inbox — stamps the outgoing work as
    // "done" with its outcome so it lands in the Finished list.
    outcome: z.enum(["success", "unsuccess"]).optional(),
    // User-given Work arguments collected at completion → merged into Ticket.context.
    args: z.record(z.string(), z.string()).optional(),
}).refine((d) => !!d.workerId !== !!d.statusId, {
    message: "Provide exactly one of workerId or statusId",
});

// ── Hybrid retry schedule helpers ──────────────────────────────────────────────
// A waiting worker carries retrySchedule: an ordered list of phases that runs
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

// PATCH /api/tickets/[id]/worker
// Body: { workerId: string, note?: string, visibility?: string }
// Returns { ok: true }
export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { user, response } = await requireAuth();
        if (response) return response;
        const userId = user.id;
        const author = await buildActorSnapshot(userId);

        const { id } = await params;
        const ticketId = Number(id);
        const { data, error } = await validateRequest(req, workerUpdateSchema);
        if (error) return error;
        const { workerId, statusId, note, visibility, outcome, args } = data;

        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            include: { repair: { select: { deviceId: true } } },
        });
        if (!ticket) {
            return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
        }

        // Capture previous worker before update (needed for auto-revert + completion stamp)
        const prevWorkerId = ticket.workerId;

        // ── Outcome → STAGE jump ────────────────────────────────────────────────
        // The completed worker routes this outcome straight to another status (not a
        // same-stage worker). Advance to that status + its entry worker, stamp the
        // outgoing work done, and run the same post-move powers (spawn / actions /
        // auto-advance). Self-contained so the worker-landing + retry logic below is
        // left completely untouched.
        if (statusId) {
            const targetStatus = await prisma.ticketStatus.findUnique({
                where: { id: statusId },
                select: { id: true, label: true, work: { select: { permissionId: true } } },
            });
            if (!targetStatus) {
                return NextResponse.json({ error: "Status not found" }, { status: 404 });
            }
            if (!passesWorkGate(user, targetStatus.work)) {
                return NextResponse.json({ error: "You don't have permission for this work" }, { status: 403 });
            }

            const entrySub = await findEntryWorker(statusId);
            const newWorkerId = entrySub?.id ?? null;
            const prevSub = prevWorkerId
                ? await prisma.ticketWorker.findUnique({ where: { id: prevWorkerId }, select: { label: true, autoRevertOnClear: true, actions: true } })
                : null;

            await prisma.$transaction(async (tx) => {
                const mergedContext = args && Object.keys(args).length
                    ? { ...((ticket.context as Record<string, unknown> | null) ?? {}), ...args }
                    : undefined;
                await tx.ticket.update({
                    where: { id: ticketId },
                    data: {
                        workerId: newWorkerId,
                        status: statusId,
                        ...(mergedContext && { context: mergedContext as Prisma.InputJsonValue }),
                        wakeAt: null, retryCount: 0, retryKeyId: null,
                        updatedAt: new Date(),
                    },
                });

                // Completion stamp for the OUTGOING work (feeds the Finished list); or a
                // plain note when there's no recorded outcome.
                if (outcome && prevWorkerId) {
                    await tx.ticketLog.create({
                        data: {
                            ticketId, status: ticket.status, workerId: prevWorkerId,
                            note: `Work done · ${outcome === "success" ? "Success" : "Unsuccess"}${note ? " — " + note : ""}`,
                            author,
                        },
                    });
                } else if (note) {
                    await tx.ticketLog.create({
                        data: { ticketId, status: ticket.status, workerId: prevWorkerId ?? undefined, note, visibility: visibility === "PUBLIC" ? "PUBLIC" : "INTERNAL", author },
                    });
                }

                // Auto-revert participants the outgoing worker added.
                if (prevWorkerId && prevSub?.autoRevertOnClear) {
                    const toRevert = await tx.ticketParticipant.findMany({
                        where: { ticketId, addedByWorkerId: prevWorkerId, removedAt: null },
                        select: { id: true, user: { select: { name: true } } },
                    });
                    for (const p of toRevert) {
                        await tx.ticketParticipant.update({ where: { id: p.id }, data: { removedAt: new Date(), removedByWorkerId: newWorkerId } });
                        await tx.ticketLog.create({ data: { ticketId, status: statusId, note: `Secondary owner auto-removed: ${p.user.name} (worker changed)`, author } });
                    }
                }

                // Stage-advance logs (+ the entry worker landed in, + its transition note).
                await tx.ticketLog.create({ data: { ticketId, status: statusId, note: `Auto-advanced by: ${prevSub?.label ?? "work"}`, author } });
                if (entrySub) {
                    await tx.ticketLog.create({ data: { ticketId, status: statusId, workerId: entrySub.id, note: `Entered: ${entrySub.label}`, author } });
                    const landed = await tx.ticketWorker.findUnique({ where: { id: entrySub.id }, select: { transitionNote: true } });
                    const tn = landed?.transitionNote?.trim();
                    if (tn) await tx.ticketLog.create({ data: { ticketId, status: statusId, workerId: entrySub.id, note: tn, visibility: "PUBLIC", author } });
                }
            });

            // 5th power — entry worker may spawn a child pipeline (best-effort).
            if (newWorkerId) {
                const landing = await prisma.ticketWorker.findUnique({ where: { id: newWorkerId }, select: { spawnPipelineId: true } });
                if (landing?.spawnPipelineId) {
                    await spawnChild({ parentId: ticketId, parentStatus: statusId, parentWorkerId: newWorkerId, spawnPipelineId: landing.spawnPipelineId, deviceId: ticket.repair?.deviceId ?? null, userId }).catch(() => { /* never blocks the move */ });
                }
            }
            await reconcileParentFromChild(ticketId, userId).catch(() => { /* best-effort */ });
            // 6th power — the completed worker's action chain, filtered by outcome.
            if (outcome && prevWorkerId) {
                await runWorkerActions({ ticketId, status: statusId, workerId: prevWorkerId, deviceId: ticket.repair?.deviceId ?? null, userId, outcome, author }, prevSub?.actions).catch(() => { /* best-effort */ });
            }
            // If the entry worker is itself an Action (auto Work), run it + continue.
            const auto = await autoAdvance(ticketId, userId).catch(() => ({ openTabs: [] as string[], navigateTo: null }));
            return NextResponse.json({ ok: true, openTabs: auto.openTabs, navigateTo: auto.navigateTo });
        }

        const worker = await prisma.ticketWorker.findUnique({
            where: { id: workerId! },
            include: { work: { select: { permissionId: true } } },
        });
        if (!worker) {
            return NextResponse.json({ error: "Worker not found" }, { status: 404 });
        }
        // Work-permission gate: only staff holding the worker' Work permission
        // may set it (ungated works are open to anyone; admin:bypass always passes).
        if (!passesWorkGate(user, worker.work)) {
            return NextResponse.json({ error: "You don't have permission for this work" }, { status: 403 });
        }

        const triggerMapOf = (s: { triggerMap?: unknown } | null) =>
            (s?.triggerMap ?? {}) as Record<string, string>;

        // ── Hybrid retry schedule resolution ───────────────────────────────────
        // The retry schedule lives on the worker being ACTED ON (the one we're
        // leaving). An Unsuccess on a scheduled worker means "this attempt
        // failed" → keep the ticket ON that worker and schedule the next attempt
        // (overriding the fail-route ✗→, which is only honoured for non-scheduled
        // subs), or give up to its exhausted target once the schedule runs out.
        // wakeAt = now + the interval of the phase the failure count falls in,
        // densest first → the ticket drops into the Waiting tab. Arriving at a
        // scheduled sub WITHOUT a failure leaves wakeAt null → the first attempt is
        // due now. retryCount = failures so far, keyed by the worker so the
        // calling loop and parts loop count independently.
        const currentSub = prevWorkerId
            ? (prevWorkerId === workerId
                ? worker
                : await prisma.ticketWorker.findUnique({
                    where: { id: prevWorkerId },
                    select: { id: true, label: true, retrySchedule: true, failWorkerId: true },
                }))
            : null;
        const currentPhases = parseSchedule(currentSub?.retrySchedule);
        // Past the statusId early-return, workerId is guaranteed (schema refine: exactly one).
        let landingWorkerId: string = worker.id;
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
                landingWorkerId = currentSub.id;          // stay put, snoozed until due
                retryCount = fails;
                retryKeyId = currentSub.id;
                wakeAt = addInterval(phase.unit, phase.every);
            } else if (currentSub.failWorkerId) {
                landingWorkerId = currentSub.failWorkerId;  // schedule exhausted → the unsuccess route (give up)
                exhaustedFrom = currentSub.label;
            } else {
                landingWorkerId = currentSub.id;          // exhausted, no target → stay, stop re-arming
                retryCount = carried;
                retryKeyId = currentSub.id;
            }
        } else {
            // Arriving at a scheduled sub (no failure) → attempt 1 is due now; seed the
            // counter key so the first Unsuccess counts from here.
            const targetPhases = parseSchedule(worker.retrySchedule);
            if (targetPhases.length > 0) {
                retryKeyId = worker.id;
                retryCount = ticket.retryKeyId === worker.id ? ticket.retryCount : 0;
            }
        }

        // The worker we actually land on (the target, or the give-up redirect).
        // Its triggerMap drives any auto-advance to a new STATUS — so a give-up
        // target that is a shim (e.g. → Closed) transitions in this same request.
        const landingSub = landingWorkerId === workerId
            ? worker
            : await prisma.ticketWorker.findUnique({
                where: { id: landingWorkerId },
                select: { id: true, label: true, triggerMap: true },
            });
        const triggerStatusId = triggerMapOf(landingSub)[ticket.status] ?? null;
        const newMainStatus = triggerStatusId ?? ticket.status;
        // On auto-advance to a new status, apply that status's entry worker
        // (mirrors ticket create + PUT status change). Without this the ticket
        // would land in the new status with no work worker / inbox item.
        const entrySub = triggerStatusId ? await findEntryWorker(triggerStatusId) : null;
        const newWorkerId = triggerStatusId ? (entrySub?.id ?? null) : landingWorkerId;
        // Auto-advancing past a waiting state clears the snooze/retry runtime.
        if (triggerStatusId) { wakeAt = null; retryCount = 0; retryKeyId = null; }

        // ── Transaction: update ticket + auto-revert old participants ───────────
        await prisma.$transaction(async (tx) => {
            // 1. Update ticket (incl. snooze/retry runtime — wakeAt drives the
            //    Work Inbox "Waiting" bucket; retryCount/retryKeyId bound the loop)
            // User-given work arguments collected at completion → merged into context.
            const mergedContext = args && Object.keys(args).length
                ? { ...((ticket.context as Record<string, unknown> | null) ?? {}), ...args }
                : undefined;
            await tx.ticket.update({
                where: { id: ticketId },
                data: {
                    workerId: newWorkerId,
                    status: newMainStatus,
                    ...(mergedContext && { context: mergedContext as Prisma.InputJsonValue }),
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
                        workerId: newWorkerId,
                        note: `Retry limit reached on "${exhaustedFrom}" — routed onward`,
                        author,
                    },
                });
            }

            // 2. Auto-revert participants added by the outgoing worker. Compare
            //    against the ACTUAL landing sub (newWorkerId), not the requested
            //    target — a snoozed retry stays put (prev === landing) and must NOT revert.
            if (prevWorkerId && prevWorkerId !== newWorkerId) {
                const prevSub = await tx.ticketWorker.findUnique({
                    where: { id: prevWorkerId },
                    select: { autoRevertOnClear: true },
                });
                if (prevSub?.autoRevertOnClear) {
                    const toRevert = await tx.ticketParticipant.findMany({
                        where: { ticketId, addedByWorkerId: prevWorkerId, removedAt: null },
                        select: { id: true, user: { select: { name: true } } },
                    });
                    for (const p of toRevert) {
                        await tx.ticketParticipant.update({
                            where: { id: p.id },
                            data: { removedAt: new Date(), removedByWorkerId: newWorkerId },
                        });
                        await tx.ticketLog.create({
                            data: {
                                ticketId,
                                status: newMainStatus,
                                note: `Secondary owner auto-removed: ${p.user.name} (worker changed)`,
                                author,
                            },
                        });
                    }
                }
            }

            // 3. Log the worker change (when an outcome is recorded, the note rides
            //    on the completion stamp below instead, to avoid a duplicate line).
            await tx.ticketLog.create({
                data: {
                    ticketId,
                    status: ticket.status,
                    workerId: newWorkerId,
                    note: outcome ? null : (note || null),
                    visibility: visibility === "PUBLIC" ? "PUBLIC" : "INTERNAL",
                    author,
                },
            });

            // 3c. Auto transition note — the worker just ENTERED carries a fixed PUBLIC
            //     message (TicketWorker.transitionNote) posted to the timeline with no
            //     popup. Skipped on a self-loop (retry/snooze re-entry on the same worker).
            if (newWorkerId && newWorkerId !== prevWorkerId) {
                const landed = await tx.ticketWorker.findUnique({
                    where: { id: newWorkerId },
                    select: { transitionNote: true },
                });
                const tn = landed?.transitionNote?.trim();
                if (tn) {
                    await tx.ticketLog.create({
                        data: { ticketId, status: newMainStatus, workerId: newWorkerId, note: tn, visibility: "PUBLIC", author },
                    });
                }
            }

            // 3b. Completion stamp — marks the OUTGOING work (prevWorkerId) done with
            //     its outcome. The Work Inbox "Finished" list reads these (joins the
            //     worker' Work, parses Success/Unsuccess from the note).
            if (outcome && prevWorkerId) {
                await tx.ticketLog.create({
                    data: {
                        ticketId,
                        status: ticket.status,
                        workerId: prevWorkerId,
                        note: `Work done · ${outcome === "success" ? "Success" : "Unsuccess"}${note ? " — " + note : ""}`,
                        author,
                    },
                });
            }

            // 4. Log auto-advance if triggered (+ the entry worker it landed in)
            if (triggerStatusId) {
                await tx.ticketLog.create({
                    data: {
                        ticketId,
                        status: triggerStatusId,
                        note: `Auto-advanced by: ${landingSub?.label ?? worker.label}`,
                        author,
                    },
                });
                if (entrySub) {
                    await tx.ticketLog.create({
                        data: {
                            ticketId,
                            status: triggerStatusId,
                            workerId: entrySub.id,
                            note: `Entered: ${entrySub.label}`,
                            author,
                        },
                    });
                }
            }
        });

        // 5th power — if the landing worker spawns a child pipeline, open the
        // child on whatever entity that pipeline rides (ticket/task/deal/…), via the
        // CHILD_ENTITIES registry (idempotent; best-effort so it never blocks the move).
        if (newWorkerId) {
            const landing = await prisma.ticketWorker.findUnique({
                where: { id: newWorkerId },
                select: { spawnPipelineId: true },
            });
            if (landing?.spawnPipelineId) {
                await spawnChild({
                    parentId: ticketId,
                    parentStatus: newMainStatus,
                    parentWorkerId: newWorkerId,
                    spawnPipelineId: landing.spawnPipelineId,
                    deviceId: ticket.repair?.deviceId ?? null,
                    userId,
                }).catch(() => { /* spawn failure must not fail the move */ });
            }
        }

        // If this move took a CHILD ticket onto a worker that signals its parent,
        // reconcile the parent (fire its Success / Unsuccess route).
        await reconcileParentFromChild(ticketId, userId).catch(() => { /* best-effort */ });

        // 6th power — run the COMPLETED worker's action chain (filtered by the recorded
        // outcome). Best-effort; never blocks the move. The completed worker is the one
        // being left (prevWorkerId) — its on-success / on-fail / always actions fire here.
        if (outcome && prevWorkerId) {
            const completed = await prisma.ticketWorker.findUnique({
                where: { id: prevWorkerId },
                select: { actions: true },
            });
            await runWorkerActions(
                { ticketId, status: newMainStatus, workerId: prevWorkerId, deviceId: ticket.repair?.deviceId ?? null, userId, outcome, author },
                completed?.actions,
            ).catch(() => { /* best-effort */ });
        }

        // TODO(rbac): handoffRole auto-assignment removed (it looked staff up by the
        // legacy User.role). Re-add Position-based handoff when RBAC is re-wired.
        // TODO(notify): worker notifications detached — re-add later, decoupled.

        // If the ticket landed on an Action (auto Work), run it + continue the outcome
        // chain server-side. Best-effort — the human move above already succeeded.
        // openTabs = URLs of open_tab Actions that succeeded → the client pops them (the
        // server can't open browser tabs).
        const auto = await autoAdvance(ticketId, userId).catch(() => ({ openTabs: [] as string[], navigateTo: null }));
        return NextResponse.json({ ok: true, openTabs: auto.openTabs, navigateTo: auto.navigateTo });
    } catch (e) {
        return handleApiError(e, "Failed to update worker");
    }
}

// DELETE /api/tickets/[id]/worker
// Clears the current worker ("Close" the ask). Open to any authenticated
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
            include: { ticketWorker: { select: { label: true } } },
        });
        if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
        if (!ticket.workerId) return NextResponse.json({ ok: true }); // already clear

        const label = ticket.ticketWorker?.label ?? "Worker";
        await prisma.$transaction(async (tx) => {
            await tx.ticket.update({
                where: { id: ticketId },
                data: { workerId: null, updatedAt: new Date() },
            });
            await tx.ticketLog.create({
                data: {
                    ticketId,
                    status: ticket.status,
                    note: `✓ ${label} closed — information acknowledged`,
                    author: await buildActorSnapshot(user.id),
                },
            });
        });

        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to close worker");
    }
}
