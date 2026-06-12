import { prisma } from "@/shared/lib/prisma/prismaClient";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";

// ── Child-entity registry ─────────────────────────────────────────────────────
// A worker' spawnPipelineId resolves a target Pipeline; that pipeline's
// `entityType` selects which TABLE the spawned child row is created in. Every
// entity that rides the shared Pipeline/TicketStatus spine registers a creator
// here, so spawn is data-driven (no hardcoded `ticket.create`).
//
// The parent is always a repair Ticket; each child carries the uniform back-link
// (parentTicketId, parentWorkerId, context) so the parent can mirror children
// of any type with one indexed query per table.
//
// NOT registered (intentional no-op): "voucher" (P7 InvVoucher), "delivery" (P8) and
// "refund" (P9) are order-bound / protected accounting surfaces — a Delivery/Refund's
// orderSource+orderId and a voucher's balanced GL lines can't be fabricated from a
// repair ticket without corrupting those flows. Spawning into them logs + no-ops.
// "none" = pipelines with no entity table yet.

export type ChildEntityType = "ticket" | "task" | "deal";

export type SpawnArgs = {
    parentTicketId: number;
    parentWorkerId: string;
    pipelineId: string;
    entryStatusId: string;             // entry-point status of the target pipeline
    startWorkerId: string | null;   // entry worker (tickets only; others ride status)
    deviceId: number;                  // parent's device — a ticket child inherits it
    userId: number;
};

export type MirrorChild = {
    type: ChildEntityType;
    id: string;
    pipelineId: string | null;
    pipelineLabel: string | null;
    pipelineColor: string | null;
    statusId: string | null;
    statusLabel: string | null;
    statusColor: string | null;
    subLabel: string | null;           // worker label (tickets only)
    subColor: string | null;
    isTerminal: boolean;
    title: string | null;              // task/deal title (tickets show device instead)
};

type Registry = {
    create: (a: SpawnArgs) => Promise<string>;
    hasOpenChild: (parentTicketId: number, parentWorkerId: string) => Promise<boolean>;
    listChildren: (parentTicketId: number) => Promise<MirrorChild[]>;
};

const spawnContext = (a: SpawnArgs) => ({
    spawnedFrom: { ticketId: a.parentTicketId, workerId: a.parentWorkerId },
});
const childTitle = (a: SpawnArgs) => `Spawned from ticket #${a.parentTicketId}`;

// Shared select fragments for the pipeline header on a mirrored child.
const pipelineSel = { select: { id: true, label: true, color: true } };
const statusSel = { select: { label: true, color: true, isTerminal: true } };

export const CHILD_ENTITIES: Record<ChildEntityType, Registry> = {
    // ── Ticket (P1 service / P2 support) — child inherits the parent's device ──
    ticket: {
        async create(a) {
            const row = await prisma.ticket.create({
                data: {
                    pipelineId: a.pipelineId, status: a.entryStatusId, workerId: a.startWorkerId,
                    deviceId: a.deviceId, parentTicketId: a.parentTicketId, parentWorkerId: a.parentWorkerId,
                    context: spawnContext(a),
                },
                select: { id: true },
            });
            return String(row.id);
        },
        async hasOpenChild(parentTicketId, parentWorkerId) {
            return (await prisma.ticket.count({
                where: { parentTicketId, parentWorkerId, ticketStatus: { isTerminal: false } },
            })) > 0;
        },
        async listChildren(parentTicketId) {
            const rows = await prisma.ticket.findMany({
                where: { parentTicketId },
                orderBy: { createdAt: "desc" },
                select: { id: true, pipeline: pipelineSel, status: true,
                    ticketStatus: statusSel, ticketWorker: { select: { label: true, color: true } } },
            });
            return rows.map((r) => ({ type: "ticket" as const, id: String(r.id),
                pipelineId: r.pipeline?.id ?? null, pipelineLabel: r.pipeline?.label ?? null, pipelineColor: r.pipeline?.color ?? null,
                statusId: r.status, statusLabel: r.ticketStatus?.label ?? null, statusColor: r.ticketStatus?.color ?? null,
                subLabel: r.ticketWorker?.label ?? null, subColor: r.ticketWorker?.color ?? null,
                isTerminal: r.ticketStatus?.isTerminal ?? false, title: null }));
        },
    },

    // ── Task (P4 internal-management) — device-free, status-only ──
    task: {
        async create(a) {
            const row = await prisma.task.create({
                data: {
                    pipelineId: a.pipelineId, status: a.entryStatusId, title: childTitle(a),
                    createdBy: await buildActorSnapshot(a.userId),
                    parentTicketId: a.parentTicketId, parentWorkerId: a.parentWorkerId, context: spawnContext(a),
                },
                select: { id: true },
            });
            return row.id;
        },
        async hasOpenChild(parentTicketId, parentWorkerId) {
            return (await prisma.task.count({
                where: { parentTicketId, parentWorkerId, ticketStatus: { isTerminal: false } },
            })) > 0;
        },
        async listChildren(parentTicketId) {
            const rows = await prisma.task.findMany({
                where: { parentTicketId },
                orderBy: { createdAt: "desc" },
                select: { id: true, pipeline: pipelineSel, status: true, title: true, ticketStatus: statusSel },
            });
            return rows.map((r) => ({ type: "task" as const, id: r.id,
                pipelineId: r.pipeline?.id ?? null, pipelineLabel: r.pipeline?.label ?? null, pipelineColor: r.pipeline?.color ?? null,
                statusId: r.status, statusLabel: r.ticketStatus?.label ?? null, statusColor: r.ticketStatus?.color ?? null,
                subLabel: null, subColor: null, isTerminal: r.ticketStatus?.isTerminal ?? false, title: r.title }));
        },
    },

    // ── Deal (P3 sales / P5 marketing / P6 deals) — device-free, status-only ──
    deal: {
        async create(a) {
            const row = await prisma.deal.create({
                data: {
                    pipelineId: a.pipelineId, status: a.entryStatusId, title: childTitle(a),
                    createdBy: await buildActorSnapshot(a.userId),
                    parentTicketId: a.parentTicketId, parentWorkerId: a.parentWorkerId, context: spawnContext(a),
                },
                select: { id: true },
            });
            return String(row.id);
        },
        async hasOpenChild(parentTicketId, parentWorkerId) {
            return (await prisma.deal.count({
                where: { parentTicketId, parentWorkerId, ticketStatus: { isTerminal: false } },
            })) > 0;
        },
        async listChildren(parentTicketId) {
            const rows = await prisma.deal.findMany({
                where: { parentTicketId },
                orderBy: { createdAt: "desc" },
                select: { id: true, pipeline: pipelineSel, status: true, title: true, ticketStatus: statusSel },
            });
            return rows.map((r) => ({ type: "deal" as const, id: String(r.id),
                pipelineId: r.pipeline?.id ?? null, pipelineLabel: r.pipeline?.label ?? null, pipelineColor: r.pipeline?.color ?? null,
                statusId: r.status, statusLabel: r.ticketStatus?.label ?? null, statusColor: r.ticketStatus?.color ?? null,
                subLabel: null, subColor: null, isTerminal: r.ticketStatus?.isTerminal ?? false, title: r.title }));
        },
    },
};

export function isSupportedEntityType(t: string): t is ChildEntityType {
    return t in CHILD_ENTITIES;
}

// Gather every spawned child of a parent ticket, across all entity tables — used by
// the parent's "Sub-pipelines" mirror panel.
export async function listAllChildren(parentTicketId: number): Promise<MirrorChild[]> {
    const lists = await Promise.all(Object.values(CHILD_ENTITIES).map((r) => r.listChildren(parentTicketId)));
    return lists.flat();
}
