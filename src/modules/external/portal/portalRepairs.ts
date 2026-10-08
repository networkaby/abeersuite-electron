import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";

export type PortalRepair = {
    id: number;
    device: string;
    /** The customer-facing step ("Waiting for part") — the worker's public label wins over the status name. */
    status: string;
    updatedAt: string;
    createdAt: string;
};

/** A profile's latest repair tickets, newest first — the portal's My Repairs and the customer app share it. */
export async function loadPortalRepairs(accountId: number): Promise<PortalRepair[]> {
    const tickets = await prisma.ticket.findMany({
        where: { repair: { device: { accountId } } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
            id: true,
            createdAt: true,
            updatedAt: true,
            repair: { select: { device: { select: { type: true, brand: true, model: true } } } },
            ticketStatus: { select: { label: true } },
            ticketWorker: { select: { publicLabel: true } },
        },
    });
    return tickets.map((t) => {
        const d = t.repair?.device;
        return {
            id: t.id,
            device: [d?.brand, d?.model].filter(Boolean).join(" ") + (d?.type ? ` · ${d.type}` : ""),
            status: t.ticketWorker?.publicLabel || t.ticketStatus.label,
            updatedAt: t.updatedAt.toISOString(),
            createdAt: t.createdAt.toISOString(),
        };
    });
}
