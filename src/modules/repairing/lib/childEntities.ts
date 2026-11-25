import { prisma, prismaWhereSaved } from "@/shared/lib/prisma/prismaClient";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";

// ── Child spawn (5th power) ────────────────────────────────────────────────────
// Every pipeline flavour is now a Ticket + optional 1:1 detail, so spawning a child
// is uniform: create a core Ticket row on the target pipeline, plus the detail row
// its `entityType` (flavour) calls for. Only a few flavours are spawnable from a
// repair parent:
//   repair — child inherits the parent's device (TicketRepair.deviceId).
//   deal   — a device-free sales opportunity (bare TicketDeal).
//   task   — a bare core row, no detail.
// order / delivery / refund are order-bound (their orderSource+orderId can't be
// fabricated from a repair) and "none" has no flavour — spawning into them no-ops.

export type ChildFlavour = "repair" | "deal" | "task";
const SPAWNABLE = new Set<ChildFlavour>(["repair", "deal", "task"]);

export function isSpawnableFlavour(t: string): t is ChildFlavour {
    return SPAWNABLE.has(t as ChildFlavour);
}

export type SpawnArgs = {
    parentTicketId: number;
    parentWorkerId: string;
    pipelineId: string;
    entryStatusId: string;             // entry-point status of the target pipeline
    startWorkerId: string | null;      // entry worker (repair rides workers; deal/task ride status)
    deviceId: number | null;           // parent's device — a repair child inherits it
    userId: number;
    seedContext?: Record<string, unknown>;  // pipeline-specific context mapped INTO the child
};

const spawnContext = (a: SpawnArgs) => ({
    // pipeline-specific worker context first; spawnedFrom is the system link and
    // always wins (a stray seed key can't clobber the parent back-reference).
    ...(a.seedContext ?? {}),
    spawnedFrom: { ticketId: a.parentTicketId, workerId: a.parentWorkerId },
});
const childTitle = (a: SpawnArgs) => `Spawned from ticket #${a.parentTicketId}`;

// Create a child Ticket (+ optional detail) of the given flavour. Returns its id, or
// null when it can't be created (a repair child without a device to inherit).
export async function createChild(flavour: ChildFlavour, a: SpawnArgs): Promise<number | null> {
    const base = {
        pipelineId: a.pipelineId,
        status: a.entryStatusId,
        workerId: a.startWorkerId,
        parentTicketId: a.parentTicketId,
        parentWorkerId: a.parentWorkerId,
        context: spawnContext(a),
        createdBy: await buildActorSnapshot(a.userId),
    };

    if (flavour === "repair") {
        if (a.deviceId == null) return null;   // a repair child needs the parent's device
        const row = await prisma.ticket.create({
            data: { ...base, repair: { create: { deviceId: a.deviceId } } },
            select: { id: true },
        });
        return row.id;
    }

    if (flavour === "deal") {
        const row = await prisma.ticket.create({
            data: { ...base, title: childTitle(a), deal: { create: {} } },
            select: { id: true },
        });
        return row.id;
    }

    // task — a bare core row (no detail)
    const row = await prisma.ticket.create({
        data: { ...base, title: childTitle(a) },
        select: { id: true },
    });
    return row.id;
}

// One OPEN child per (parent, spawning worker) — uniform now that every child is a
// Ticket (no per-table fan-out).
export async function hasOpenChild(parentTicketId: number, parentWorkerId: string): Promise<boolean> {
    return (await prismaWhereSaved().ticket.count({
        where: { parentTicketId, parentWorkerId, ticketStatus: { isTerminal: false } },
    })) > 0;
}

export type MirrorChild = {
    type: string;                      // pipeline flavour (entityType)
    id: number;
    pipelineId: string | null;
    pipelineLabel: string | null;
    pipelineColor: string | null;
    statusId: string | null;
    statusLabel: string | null;
    statusColor: string | null;
    subLabel: string | null;           // worker label (repair only)
    subColor: string | null;
    isTerminal: boolean;
    title: string | null;              // deal/task title (repair shows device instead)
};

// Gather every spawned child of a parent ticket — a single Ticket query now (was a
// Promise.all across five tables). Used by the parent's "Sub-pipelines" mirror panel.
export async function listAllChildren(parentTicketId: number): Promise<MirrorChild[]> {
    const rows = await prisma.ticket.findMany({
        where: { parentTicketId },
        orderBy: { createdAt: "desc" },
        select: {
            id: true, status: true, title: true,
            pipeline: { select: { id: true, label: true, color: true, entityType: true } },
            ticketStatus: { select: { label: true, color: true, isTerminal: true } },
            ticketWorker: { select: { label: true, color: true } },
        },
    });
    return rows.map((r) => ({
        type: r.pipeline?.entityType ?? "none",
        id: r.id,
        pipelineId: r.pipeline?.id ?? null,
        pipelineLabel: r.pipeline?.label ?? null,
        pipelineColor: r.pipeline?.color ?? null,
        statusId: r.status,
        statusLabel: r.ticketStatus?.label ?? null,
        statusColor: r.ticketStatus?.color ?? null,
        subLabel: r.ticketWorker?.label ?? null,
        subColor: r.ticketWorker?.color ?? null,
        isTerminal: r.ticketStatus?.isTerminal ?? false,
        title: r.title,
    }));
}
