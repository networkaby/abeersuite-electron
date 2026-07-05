import { prisma } from "@/shared/lib/prisma/prismaClient";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";
import { createChild, hasOpenChild, isSpawnableFlavour, type ChildFlavour } from "./childEntities";

// 5th power: a worker with spawnPipelineId opens a CHILD on another pipeline
// (inbound parts courier, an internal task, a sales deal…). Every child is a Ticket
// now; the TARGET pipeline's `entityType` (flavour) decides which optional detail row
// it gets — dispatched through createChild(), not a hardcoded ticket.create. The child
// links back via parentTicketId / parentWorkerId so the parent can mirror it and
// advance when the child terminates.
//
// Idempotent: one OPEN child per (parent, spawning worker) — re-entering the same
// worker (e.g. a retry loop) does not spawn duplicates.
//
// Returns the child's id + flavour, or null when nothing was created (unspawnable
// flavour, no entry status, an open child already exists, or a repair child without a
// device to inherit).
export async function spawnChild(args: {
    parentId: number;
    parentStatus: string;          // the parent's status at spawn time (for the log)
    parentWorkerId: string;     // the worker that spawned it (resolve target)
    spawnPipelineId: string;       // pipeline to create the child on
    deviceId: number | null;       // a repair child inherits the parent's device
    userId: number;
    seedContext?: Record<string, unknown>;  // pipeline-specific context mapped into the child
}): Promise<{ id: number; type: ChildFlavour } | null> {
    const { parentId, parentStatus, parentWorkerId, spawnPipelineId, deviceId, userId, seedContext } = args;
    const author = await buildActorSnapshot(userId);

    const pipeline = await prisma.pipeline.findUnique({
        where: { id: spawnPipelineId },
        select: { entityType: true, statuses: { where: { isEntryPoint: true }, select: { id: true, startWorkerId: true }, take: 1 } },
    });
    if (!pipeline) return null;

    if (!isSpawnableFlavour(pipeline.entityType)) {
        // e.g. "order"/"delivery"/"refund" (order-bound) or "none" — log and no-op
        // rather than fabricate a malformed row.
        await prisma.ticketLog.create({
            data: { ticketId: parentId, status: parentStatus, workerId: parentWorkerId,
                note: `Spawn skipped — ${spawnPipelineId} has no spawnable flavour (${pipeline.entityType})`, author },
        });
        return null;
    }

    if (await hasOpenChild(parentId, parentWorkerId)) return null;  // already has an open child

    const entry = pipeline.statuses[0];
    if (!entry) return null;  // target pipeline has no entry status — nothing to spawn into

    const childId = await createChild(pipeline.entityType, {
        parentTicketId: parentId, parentWorkerId, pipelineId: spawnPipelineId,
        entryStatusId: entry.id, startWorkerId: entry.startWorkerId ?? null, deviceId, userId, seedContext,
    });
    if (childId == null) {
        await prisma.ticketLog.create({
            data: { ticketId: parentId, status: parentStatus, workerId: parentWorkerId,
                note: `Spawn skipped — a ${pipeline.entityType} child needs a device`, author },
        });
        return null;
    }

    // Log on the PARENT ticket (always), and — for repair children — a birth line on
    // the child (its own timeline). Deal/task children ride status without a worker.
    await prisma.ticketLog.create({
        data: { ticketId: parentId, status: parentStatus, workerId: parentWorkerId,
            note: `Spawned ${pipeline.entityType} child #${childId} on ${spawnPipelineId}`, author },
    });
    if (pipeline.entityType === "repair") {
        await prisma.ticketLog.create({
            data: { ticketId: childId, status: entry.id, workerId: entry.startWorkerId ?? null,
                note: `Created from ticket #${parentId}`, author },
        });
    }
    return { id: childId, type: pipeline.entityType };
}

// Child-side report-back: when a CHILD ticket reaches a worker carrying a
// parentSignal ("success" / "fail"), bump the parent off its spawning worker
// via that worker' Success / Unsuccess route. Reads the child's CURRENT
// worker (state-based, so it's tolerant of the child running ahead) and is
// called on every child change. No-op unless the child carries a signal, has a
// parent link, and the parent is still on the spawning worker.
export async function reconcileParentFromChild(childId: number, userId: number): Promise<void> {
    const child = await prisma.ticket.findUnique({
        where: { id: childId },
        select: {
            id: true, parentTicketId: true, parentWorkerId: true,
            ticketWorker: { select: { label: true, parentSignal: true } },
        },
    });
    const signal = child?.ticketWorker?.parentSignal;
    if (!child?.parentTicketId || !child.parentWorkerId || (signal !== "success" && signal !== "fail")) return;

    const parent = await prisma.ticket.findUnique({
        where: { id: child.parentTicketId },
        select: { id: true, status: true, workerId: true },
    });
    if (!parent || parent.workerId !== child.parentWorkerId) return;  // already moved on

    const spawningSub = await prisma.ticketWorker.findUnique({
        where: { id: child.parentWorkerId },
        select: { successWorkerId: true, failWorkerId: true },
    });
    const fail = signal === "fail";
    const target = fail ? spawningSub?.failWorkerId : spawningSub?.successWorkerId;
    if (!target) return;  // no route configured for this outcome — leave the parent put

    await prisma.ticket.update({
        where: { id: parent.id },
        data: { workerId: target, wakeAt: null, retryCount: 0, retryKeyId: null, updatedAt: new Date() },
    });
    await prisma.ticketLog.create({
        data: {
            ticketId: parent.id, status: parent.status, workerId: target,
            note: `Child #${child.id} signalled ${fail ? "Unsuccess" : "Success"} (${child.ticketWorker?.label ?? ""}) — resumed`,
            author: await buildActorSnapshot(userId),
        },
    });
}
