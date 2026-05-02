import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePortalAccountContext } from "@/lib/portal-auth-guard";

export async function GET() {
    const { context, response } = await requirePortalAccountContext();
    if (response) return response;

    const tickets = await prisma.ticket.findMany({
        where: {
            device: {
                accountId: context!.active.accountId,
            },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
            id: true,
            status: true,
            createdAt: true,
            device: { select: { brand: true, model: true, type: true } },
            ticketStatus: { select: { label: true } },
        },
    });

    return NextResponse.json(tickets);
}
