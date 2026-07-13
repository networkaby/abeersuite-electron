import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { selectPrimaryPhone } from "@/shared/lib/prisma/fragments";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;
    const { id } = await ctx.params;
    const oid = parseInt(id, 10);
    if (!Number.isFinite(oid)) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    try {
        // An order is a Ticket (flavour "order") + TicketOrder detail; account is the
        // sanctioned Account bridge. Repair tickets spawned from it link back via
        // TicketRepair.sourceOrderTicketId (id-only) — fetched separately below.
        const t = await prisma.ticket.findUnique({
            where: { id: oid },
            include: {
                account: {
                    include: {
                        company: {
                            include: {
                                phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
                                emails: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
                            },
                        },
                        person: {
                            select: { id: true, name: true, phones: selectPrimaryPhone },
                        },
                    },
                },
                ticketStatus: {
                    include: {
                        fromTransitions: {
                            include: { to: true },
                            orderBy: { to: { order: "asc" } },
                        },
                    },
                },
                order: {
                    include: {
                        person: {
                            include: {
                                phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
                                emails: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
                            },
                        },
                        lines: { include: { product: true } },
                    },
                },
            },
        });
        if (!t?.order) return NextResponse.json({ error: "Not found" }, { status: 404 });
        const relatedTickets = await prisma.ticket.findMany({
            where: { repair: { sourceOrderTicketId: oid } },
            select: { id: true, status: true, notes: true, createdAt: true },
        });
        const { order, ticketStatus, ...core } = t;
        const flat = { ...core, ...order, statusId: core.status, status: order.legacyStatus, orderStatus: ticketStatus, tickets: relatedTickets };
        return NextResponse.json(flat);
    } catch (e) {
        return handleApiError(e, "Failed to load order");
    }
}
