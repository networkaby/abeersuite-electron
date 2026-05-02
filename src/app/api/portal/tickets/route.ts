import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePortalCustomer } from "@/lib/portal-auth-guard";

export async function GET() {
    const { customerId, response } = await requirePortalCustomer();
    if (response) return response;

    const tickets = await prisma.ticket.findMany({
        where: {
            device: {
                account: { customerId: customerId! },
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
