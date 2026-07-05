import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePortalAccountContext } from "@/shared/lib/auth/portalAuthGuard";

export async function GET() {
    const { context, response } = await requirePortalAccountContext();
    if (response) return response;

    const rows = await prisma.ticket.findMany({
        where: {
            repair: { device: { accountId: context!.active.accountId } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
            id: true,
            status: true,
            createdAt: true,
            repair: { select: { device: { select: { brand: true, model: true, type: true } } } },
            ticketStatus: { select: { label: true } },
            ticketWorker: { select: { publicLabel: true } },
        },
    });

    // Flatten device back to top level for the portal ("My Repairs") UI.
    const tickets = rows.map((t) => ({
        id: t.id,
        status: t.status,
        createdAt: t.createdAt,
        device: t.repair?.device ?? null,
        ticketStatus: t.ticketStatus,
        ticketWorker: t.ticketWorker,
    }));

    return NextResponse.json(tickets);
}
