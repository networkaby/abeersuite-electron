import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { phoneMatchKey } from "@/shared/lib/format";
import { ownersByPhone } from "@/modules/message/lib/customerMessages";
import { officeTicketHref } from "@/modules/message/lib/messageLinks";

// GET /api/messages/ticket-options?phone=<10 digits>&q=<text>
//
// Open tickets a chat can be linked to (Messages → + Ticket → Link existing):
//   no q      → the chat customer's open tickets (repair, help, deal), newest first
//   q digits  → that ticket number, if still open
//   q text    → open tickets whose customer name / phone or title matches
// Read-only, a handful of rows.

const LIMIT = 8;

const SELECT = {
    id: true, title: true, notes: true, createdAt: true,
    ticketStatus: { select: { label: true } },
    account: { select: { name: true } },
    repair: { select: { ticketId: true, device: { select: { brand: true, model: true, account: { select: { name: true } } } } } },
    deal: { select: { ticketId: true } },
} as const satisfies Prisma.TicketSelect;

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const sp = new URL(req.url).searchParams;
        const q = (sp.get("q") ?? "").trim();
        const open: Prisma.TicketWhereInput = { ticketStatus: { isTerminal: false } };

        let where: Prisma.TicketWhereInput | null = null;
        if (/^\d{1,9}$/.test(q)) {
            where = { ...open, id: Number(q) };
        } else if (q.length >= 2) {
            const party: Prisma.AccountWhereInput = {
                OR: [
                    { name: { contains: q, mode: "insensitive" } },
                    { person: { phones: { some: { phone: { contains: q } } } } },
                    { company: { phones: { some: { phone: { contains: q } } } } },
                ],
            };
            where = { ...open, OR: [{ title: { contains: q, mode: "insensitive" } }, { account: party }, { repair: { device: { account: party } } }] };
        } else {
            const phone = phoneMatchKey(sp.get("phone"));
            const accountId = phone ? (await ownersByPhone([phone])).get(phone)?.accountId : null;
            if (accountId) where = { ...open, OR: [{ accountId }, { repair: { device: { accountId } } }] };
        }
        if (!where) return NextResponse.json([]);

        const rows = await prisma.ticket.findMany({ where, select: SELECT, orderBy: { createdAt: "desc" }, take: LIMIT });
        return NextResponse.json(rows.map((t) => ({
            id: t.id,
            kind: t.repair ? "repair" : t.deal ? "deal" : "help",
            title: t.title || (t.repair ? `${t.repair.device.brand} ${t.repair.device.model}`.trim() : t.notes?.split("\n")[0].slice(0, 80) || null),
            customer: t.account?.name ?? t.repair?.device.account?.name ?? null,
            status: t.ticketStatus?.label ?? null,
            createdAt: t.createdAt.toISOString(),
            href: officeTicketHref(t),
        })));
    } catch (e) {
        return handleApiError(e);
    }
}
