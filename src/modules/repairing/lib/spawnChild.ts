import { prisma } from "@/shared/lib/prisma/prismaClient";

// 5th power: a sub-status with spawnPipelineId opens a CHILD ticket on another
// pipeline (e.g. an inbound parts courier) when a ticket lands on it. The child
// rides that pipeline with the full sub-status engine; it links back via
// parentTicketId / parentSubStatusId so the parent can mirror it and (later)
// advance when the child terminates.
//
// Idempotent: one OPEN child per (parent, spawning sub-status) — re-entering the
// same sub-status (e.g. a retry loop) does not spawn duplicates.
export async function spawnChildTicket(args: {
    parentId: number;
    parentStatus: string;          // the parent's status at spawn time (for the log)
    parentSubStatusId: string;     // the sub-status that spawned it (resolve target)
    spawnPipelineId: string;       // pipeline to create the child on
    deviceId: number;              // child inherits the parent's device (simple link)
    userId: number;
}): Promise<number | null> {
    const { parentId, parentStatus, parentSubStatusId, spawnPipelineId, deviceId, userId } = args;

    const existing = await prisma.ticket.findFirst({
        where: { parentTicketId: parentId, parentSubStatusId, ticketStatus: { isTerminal: false } },
        select: { id: true },
    });
    if (existing) return null;  // already has an open child from this sub-status

    const pipeline = await prisma.pipeline.findUnique({
        where: { id: spawnPipelineId },
        select: { statuses: { where: { isEntryPoint: true }, select: { id: true, startSubStatusId: true }, take: 1 } },
    });
    const entry = pipeline?.statuses[0];
    if (!entry) return null;  // target pipeline has no entry status — nothing to spawn into

    const child = await prisma.ticket.create({
        data: {
            pipelineId: spawnPipelineId,
            status: entry.id,
            subStatusId: entry.startSubStatusId ?? null,
            deviceId,
            parentTicketId: parentId,
            parentSubStatusId,
            context: { spawnedFrom: { ticketId: parentId, subStatusId: parentSubStatusId } },
        },
        select: { id: true },
    });

    await prisma.ticketLog.createMany({
        data: [
            { ticketId: parentId, status: parentStatus, subStatusId: parentSubStatusId, note: `Spawned child #${child.id} on ${spawnPipelineId}`, userId },
            { ticketId: child.id, status: entry.id, subStatusId: entry.startSubStatusId ?? null, note: `Created from ticket #${parentId}`, userId },
        ],
    });
    return child.id;
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
