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
