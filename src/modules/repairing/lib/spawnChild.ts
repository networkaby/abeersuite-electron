import { prisma } from "@/shared/lib/prisma/prismaClient";
import { CHILD_ENTITIES, isSupportedEntityType, type ChildEntityType } from "./childEntities";

// 5th power: a sub-status with spawnPipelineId opens a CHILD on another pipeline
// (inbound parts courier, an internal task, a delivery…). The TARGET pipeline's
// `entityType` decides which table the child is created in — dispatched through the
// CHILD_ENTITIES registry, not a hardcoded ticket.create. The child links back via
// parentTicketId / parentSubStatusId so the parent can mirror it and (for ticket
// children) advance when the child terminates.
//
// Idempotent: one OPEN child per (parent, spawning sub-status) per table —
// re-entering the same sub-status (e.g. a retry loop) does not spawn duplicates.
//
// Returns the child's id (string — ids differ per table: Int vs cuid) and the
// entityType, or null when nothing was created (unsupported entityType, no entry
// status, or an open child already exists).
export async function spawnChild(args: {
    parentId: number;
    parentStatus: string;          // the parent's status at spawn time (for the log)
    parentSubStatusId: string;     // the sub-status that spawned it (resolve target)
    spawnPipelineId: string;       // pipeline to create the child on
    deviceId: number;              // a ticket child inherits the parent's device
    userId: number;
}): Promise<{ id: string; type: ChildEntityType } | null> {
    const { parentId, parentStatus, parentSubStatusId, spawnPipelineId, deviceId, userId } = args;

    const pipeline = await prisma.pipeline.findUnique({
        where: { id: spawnPipelineId },
        select: { entityType: true, statuses: { where: { isEntryPoint: true }, select: { id: true, startSubStatusId: true }, take: 1 } },
    });
    if (!pipeline) return null;

    if (!isSupportedEntityType(pipeline.entityType)) {
        // e.g. "voucher" (protected accounting core) or "none" — log and no-op rather
        // than fabricate a malformed row in a table we don't own.
        await prisma.ticketLog.create({
            data: { ticketId: parentId, status: parentStatus, subStatusId: parentSubStatusId,
                note: `Spawn skipped — ${spawnPipelineId} has no spawnable entity (${pipeline.entityType})`, userId },
        });
        return null;
    }
    const reg = CHILD_ENTITIES[pipeline.entityType];

    if (await reg.hasOpenChild(parentId, parentSubStatusId)) return null;  // already has an open child

    const entry = pipeline.statuses[0];
    if (!entry) return null;  // target pipeline has no entry status — nothing to spawn into

    const childId = await reg.create({
        parentTicketId: parentId, parentSubStatusId, pipelineId: spawnPipelineId,
        entryStatusId: entry.id, startSubStatusId: entry.startSubStatusId ?? null, deviceId, userId,
    });

    // Log on the PARENT ticket (always). The child-side log only exists for ticket
    // children (TicketLog is ticket-scoped); task/deal/delivery/refund keep their own
    // activity trails, logged by their own modules later.
    await prisma.ticketLog.create({
        data: { ticketId: parentId, status: parentStatus, subStatusId: parentSubStatusId,
            note: `Spawned ${pipeline.entityType} child #${childId} on ${spawnPipelineId}`, userId },
    });
    if (pipeline.entityType === "ticket") {
        await prisma.ticketLog.create({
            data: { ticketId: Number(childId), status: entry.id, subStatusId: entry.startSubStatusId ?? null,
                note: `Created from ticket #${parentId}`, userId },
        });
    }
    return { id: childId, type: pipeline.entityType };
}

// Child-side report-back: when a CHILD ticket reaches a sub-status carrying a
// parentSignal ("success" / "fail"), bump the parent off its spawning sub-status
// via that sub-status' Success / Unsuccess route. Reads the child's CURRENT
// sub-status (state-based, so it's tolerant of the child running ahead) and is
// called on every child change. No-op unless the child carries a signal, has a
// parent link, and the parent is still on the spawning sub-status.
export async function reconcileParentFromChild(childId: number, userId: number): Promise<void> {
    const child = await prisma.ticket.findUnique({
        where: { id: childId },
        select: {
            id: true, parentTicketId: true, parentSubStatusId: true,
            ticketSubStatus: { select: { label: true, parentSignal: true } },
        },
    });
    const signal = child?.ticketSubStatus?.parentSignal;
    if (!child?.parentTicketId || !child.parentSubStatusId || (signal !== "success" && signal !== "fail")) return;

    const parent = await prisma.ticket.findUnique({
        where: { id: child.parentTicketId },
        select: { id: true, status: true, subStatusId: true },
    });
    if (!parent || parent.subStatusId !== child.parentSubStatusId) return;  // already moved on

    const spawningSub = await prisma.ticketSubStatus.findUnique({
        where: { id: child.parentSubStatusId },
        select: { successSubStatusId: true, failSubStatusId: true },
    });
    const fail = signal === "fail";
    const target = fail ? spawningSub?.failSubStatusId : spawningSub?.successSubStatusId;
    if (!target) return;  // no route configured for this outcome — leave the parent put

    await prisma.ticket.update({
        where: { id: parent.id },
        data: { subStatusId: target, wakeAt: null, retryCount: 0, retryKeyId: null, updatedAt: new Date() },
    });
    await prisma.ticketLog.create({
        data: {
            ticketId: parent.id, status: parent.status, subStatusId: target,
            note: `Child #${child.id} signalled ${fail ? "Unsuccess" : "Success"} (${child.ticketSubStatus?.label ?? ""}) — resumed`,
            userId,
        },
    });
}
