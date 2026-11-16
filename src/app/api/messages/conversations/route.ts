import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { Prisma } from "@/generated/prisma/client";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { phoneMatchKey } from "@/shared/lib/format";
import { ownerKey, ownersByPhone, type CustomerOwner } from "@/modules/message/lib/customerMessages";
import { WA_CONVERSATION_TIMEOUT_MS } from "@/shared/lib/constants/whatsapp";

// GET /api/messages/conversations — the Messages screen's left list: one row per
// customer (a party's numbers merged; an unknown number on its own), newest first, with its unread count and the topic of its
// open conversation (asking / ticket #N / new).
//
//   filter = all | unread | open (conversation is on a ticket) | unknown (no party yet)
//   q      = number, message text, or customer name
//   page   = 1-based, PAGE_SIZE rows each
//
// One query for the page (DISTINCT ON phone, open conversation joined in) and
// one for the owners — never a query per conversation.

const PAGE_SIZE = 50;

/**
 * One customer with several numbers is one chat: rows are already newest
 * first, so the first row of an owner leads (its number, topic and last
 * message) and the rest add their numbers and unread counts. Display-only —
 * a customer's numbers on different pages each merge within their own page.
 */
function mergeByOwner(rows: Row[], owners: Map<string, CustomerOwner>) {
    const out: { r: Row; phones: string[]; unread: number }[] = [];
    const byOwner = new Map<string, (typeof out)[number]>();
    for (const r of rows) {
        const o = owners.get(r.phone);
        const lead = o ? byOwner.get(ownerKey(o)) : undefined;
        if (lead) {
            lead.phones.push(r.phone);
            lead.unread += r.unread;
            continue;
        }
        const entry = { r, phones: [r.phone], unread: r.unread };
        out.push(entry);
        if (o) byOwner.set(ownerKey(o), entry);
    }
    return out;
}
/** `unknown` is decided after the owner lookup, so it scans this many rows. */
const UNKNOWN_SCAN = 500;

type Row = {
    phone: string;
    id: number;
    channel: string;
    direction: string;
    kind: string;
    body: string;
    senderName: string | null;
    occurredAt: Date;
    unread: number;
    openTicketId: number | null;
    topic: string | null;
};

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const sp = new URL(req.url).searchParams;
        const filter = sp.get("filter") ?? "all";
        const q = sp.get("q")?.trim() ?? "";
        const page = Math.max(1, Number(sp.get("page")) || 1);

        const where: Prisma.Sql[] = [Prisma.sql`m.phone IS NOT NULL`, Prisma.sql`m.spam = false`];
        if (q) {
            // A name matches through the customer's stored numbers, as on the Call Log.
            const [persons, companies] = await Promise.all([
                prisma.person.findMany({ where: { name: { contains: q, mode: "insensitive" } }, select: { phones: { select: { phone: true } } }, take: 100 }),
                prisma.company.findMany({ where: { name: { contains: q, mode: "insensitive" } }, select: { phones: { select: { phone: true } } }, take: 100 }),
            ]);
            const nameKeys = [...persons, ...companies]
                .flatMap((c) => c.phones.map((p) => phoneMatchKey(p.phone)))
                .filter((k): k is string => !!k);
            const like = `%${q}%`;
            where.push(Prisma.sql`(
                m.phone LIKE ${like}
                OR m."senderName" ILIKE ${like}
                OR EXISTS (SELECT 1 FROM "Message" x WHERE x.phone = m.phone AND x.body ILIKE ${like})
                ${nameKeys.length ? Prisma.sql`OR m.phone IN (${Prisma.join(nameKeys)})` : Prisma.empty}
            )`);
        }

        const having: Prisma.Sql[] = [];
        if (filter === "unread") having.push(Prisma.sql`u.n > 0`);
        if (filter === "open") having.push(Prisma.sql`c.topic = 'TICKET'`);

        const unknown = filter === "unknown";
        const take = unknown ? UNKNOWN_SCAN : PAGE_SIZE + 1;
        const skip = unknown ? 0 : (page - 1) * PAGE_SIZE;

        const rows = await prisma.$queryRaw<Row[]>`
            WITH latest AS (
                SELECT DISTINCT ON (m.phone)
                       m.phone, m.id, m.channel, m.direction, m.kind, m.body, m."senderName", m."occurredAt"
                FROM "Message" m
                WHERE ${Prisma.join(where, " AND ")}
                ORDER BY m.phone, m."occurredAt" DESC
            ),
            unread AS (
                SELECT phone, COUNT(*)::int AS n FROM "Message"
                WHERE direction = 'IN' AND "seenAt" IS NULL AND spam = false
                GROUP BY phone
            ),
            conv AS (
                SELECT DISTINCT ON (c.phone) c.phone, c.topic, c."ticketId"
                FROM "MessageConversation" c
                WHERE c."closedAt" IS NULL AND c."lastMessageAt" >= ${new Date(Date.now() - WA_CONVERSATION_TIMEOUT_MS)}
                ORDER BY c.phone, c."startedAt" DESC
            )
            SELECT l.*, COALESCE(u.n, 0) AS unread, c.topic,
                   CASE WHEN c.topic = 'TICKET' THEN c."ticketId" END AS "openTicketId"
            FROM latest l
            LEFT JOIN unread u ON u.phone = l.phone
            LEFT JOIN conv c ON c.phone = l.phone
            ${having.length ? Prisma.sql`WHERE ${Prisma.join(having, " AND ")}` : Prisma.empty}
            ORDER BY l."occurredAt" DESC
            LIMIT ${take} OFFSET ${skip}
        `;

        const owners = await ownersByPhone(rows.map((r) => r.phone));
        let list = mergeByOwner(rows, owners).map(({ r, phones, unread }) => ({
            phone: r.phone,
            /** Every number of this customer on this page, newest first — shown as one chat. */
            phones,
            customer: owners.get(r.phone) ?? null,
            senderName: r.senderName,
            unread,
            openTicketId: r.openTicketId,
            /** The open conversation's topic: ASKING | TICKET | NEW, null = none open. */
            topic: r.topic,
            last: {
                id: r.id,
                channel: r.channel,
                direction: r.direction,
                kind: r.kind,
                body: r.body,
                at: r.occurredAt.toISOString(),
            },
        }));

        let hasMore: boolean;
        if (unknown) {
            const all = list.filter((c) => !c.customer);
            list = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
            hasMore = all.length > page * PAGE_SIZE;
        } else {
            hasMore = list.length > PAGE_SIZE;
            list = list.slice(0, PAGE_SIZE);
        }

        const totalUnread = await prisma.message.count({ where: { direction: "IN", seenAt: null, spam: false } });
        return NextResponse.json({ items: list, page, hasMore, totalUnread });
    } catch (e) {
        return handleApiError(e, "Failed to list conversations");
    }
}
