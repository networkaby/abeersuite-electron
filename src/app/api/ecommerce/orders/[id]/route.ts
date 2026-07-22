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
        // The linked invoice (one-click convert writes a VoucherLink kind=SHOP_ORDER).
        // Latest non-cancelled linked voucher wins — a cancelled invoice may be
        // superseded by a re-raised one.
        const invLinks = await prisma.voucherLink.findMany({
            where: { kind: "SHOP_ORDER", targetId: String(oid) },
            select: { universalVoucherId: true },
        });
        const invSpine = invLinks.length
            ? await prisma.universalVoucher.findFirst({
                  where: {
                      id: { in: invLinks.map((l) => l.universalVoucherId) },
                      status: { not: "CANCELLED" },
                      deletedAt: null,
                  },
                  orderBy: { id: "desc" },
                  select: {
                      voucherNo: true,
                      type: true,
                      status: true,
                      voucherDetail: { select: { id: true, totalAmount: true } },
                  },
              })
            : null;
        const invVoucher = invSpine?.voucherDetail
            ? {
                  id: invSpine.voucherDetail.id,
                  reference: invSpine.voucherNo,
                  type: invSpine.type,
                  status: invSpine.status,
                  totalAmount: String(invSpine.voucherDetail.totalAmount),
              }
            : null;
        const { order, ticketStatus, ...core } = t;
        const flat = { ...core, ...order, statusId: core.status, status: order.legacyStatus, orderStatus: ticketStatus, tickets: relatedTickets, invVoucher };
        return NextResponse.json(flat);
    } catch (e) {
        return handleApiError(e, "Failed to load order");
    }
}
