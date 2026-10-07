import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { phoneMatchKey, phoneKeyVariants } from "@/shared/lib/format";
import { getHelpPipeline } from "@/modules/help/lib/helpPipeline";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";
import { sourceCounterId } from "@/shared/lib/counter/sourceCounter";
import { isBillSendConfigured, sendTextMessage } from "@/shared/lib/whatsapp/metaTemplates";
import { publishChangeServer } from "@/shared/lib/realtime/serverPublish";

/**
 * Customer messages — the logic behind the Meta webhook and the Messages screen.
 *
 * A message is treated like a phone call (see prisma/schema/messages.prisma):
 * always a customer's, matched BY PHONE at read time; sometimes a ticket's;
 * sometimes a bill's. Everything here keys on the 10-digit `phone` match key.
 */

/** Meta allows free text only this long after the customer's last message. */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export type CustomerOwner = { kind: "person" | "company"; id: number; name: string };

/**
 * Phone match keys → the customer each one belongs to. One index-backed IN
 * query over every stored format of the keys — the Call Log's own lookup.
 */
export async function ownersByPhone(keys: string[]): Promise<Map<string, CustomerOwner>> {
    const owners = new Map<string, CustomerOwner>();
    const unique = Array.from(new Set(keys.filter(Boolean)));
    if (!unique.length) return owners;
    const rows = await prisma.phone.findMany({
        where: { phone: { in: unique.flatMap(phoneKeyVariants) } },
        select: {
            phone: true,
            person: { select: { id: true, name: true } },
            company: { select: { id: true, name: true } },
        },
    });
    for (const row of rows) {
        const key = phoneMatchKey(row.phone);
        if (!key || owners.has(key)) continue;
        if (row.person) owners.set(key, { kind: "person", id: row.person.id, name: row.person.name });
        else if (row.company) owners.set(key, { kind: "company", id: row.company.id, name: row.company.name });
    }
    return owners;
}

/**
 * The customer's open help ticket, if any — the one a new message joins.
 * First the ticket their latest linked message sits on (staff chose it), then
 * any open help ticket raised for this customer or this number.
 */
export async function openTicketForPhone(phone: string, owner: CustomerOwner | null): Promise<number | null> {
    const lastLinked = await prisma.message.findFirst({
        where: { phone, ticketId: { not: null } },
        orderBy: { occurredAt: "desc" },
        select: { ticketId: true },
    });
    if (lastLinked?.ticketId) {
        const t = await prisma.ticket.findUnique({ where: { id: lastLinked.ticketId }, select: { closedAt: true } });
        if (t && !t.closedAt) return lastLinked.ticketId;
    }
    const pipeline = await getHelpPipeline(prisma);
    if (!pipeline) return null;
    const or: Record<string, unknown>[] = [{ phone: { endsWith: phone } }];
    if (owner?.kind === "person") or.push({ personId: owner.id });
    if (owner?.kind === "company") or.push({ companyId: owner.id });
    const open = await prisma.ticket.findFirst({
        where: { pipelineId: pipeline.id, closedAt: null, help: { OR: or } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
    });
    return open?.id ?? null;
}

// ── Meta webhook payload (only the parts we read) ───────────────────────────────
type WaInbound = {
    id: string;
    from: string;
    timestamp?: string;
    type?: string;
    context?: { id?: string };
    text?: { body?: string };
    button?: { text?: string };
    interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
    image?: { caption?: string };
    video?: { caption?: string };
    document?: { caption?: string; filename?: string };
    location?: { name?: string; address?: string };
};
type WaStatus = {
    id: string;
    status?: string;
    timestamp?: string;
    errors?: { title?: string; message?: string }[];
};
export type WaChangeValue = {
    contacts?: { wa_id?: string; profile?: { name?: string } }[];
    messages?: WaInbound[];
    statuses?: WaStatus[];
};

function metaTime(ts: string | undefined): Date {
    const n = Number(ts);
    return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
}

/** What a message says, as one line of text. Media we do not download yet. */
function inboundBody(m: WaInbound): string {
    switch (m.type) {
        case "text": return m.text?.body ?? "";
        case "button": return m.button?.text ?? "";
        case "interactive": return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "";
        case "image": return m.image?.caption ? `[image] ${m.image.caption}` : "[image]";
        case "video": return m.video?.caption ? `[video] ${m.video.caption}` : "[video]";
        case "document": return `[document] ${m.document?.caption ?? m.document?.filename ?? ""}`.trim();
        case "location": return `[location] ${[m.location?.name, m.location?.address].filter(Boolean).join(", ")}`.trim();
        default: return `[${m.type ?? "message"}]`;
    }
}

/** Store the customer messages in one webhook change. Duplicates (Meta retries) are skipped. */
export async function ingestInbound(value: WaChangeValue): Promise<number> {
    const names = new Map((value.contacts ?? []).map((c) => [c.wa_id ?? "", c.profile?.name ?? null]));
    let stored = 0;
    for (const m of value.messages ?? []) {
        if (!m.id || !m.from) continue;
        if (await prisma.message.findUnique({ where: { externalId: m.id }, select: { id: true } })) continue;

        const phone = phoneMatchKey(m.from);
        const owner = phone ? (await ownersByPhone([phone])).get(phone) ?? null : null;
        const spam = phone
            ? !!(await prisma.message.findFirst({ where: { phone, spam: true }, select: { id: true } }))
            : false;

        // A reply to one of our messages: carry its bill (and ticket) over.
        const repliedTo = m.context?.id
            ? await prisma.message.findUnique({
                where: { externalId: m.context.id },
                select: { billKind: true, billRefId: true },
            })
            : null;
        const ticketId = phone && !spam ? await openTicketForPhone(phone, owner) : null;

        try {
            await prisma.message.create({
                data: {
                    channel: "WHATSAPP",
                    direction: "IN",
                    phone,
                    address: m.from,
                    senderName: names.get(m.from) ?? null,
                    kind: m.type ?? "text",
                    body: inboundBody(m),
                    externalId: m.id,
                    replyToExternalId: m.context?.id ?? null,
                    billKind: repliedTo?.billKind ?? null,
                    billRefId: repliedTo?.billRefId ?? null,
                    ticketId,
                    spam,
                    occurredAt: metaTime(m.timestamp),
                },
            });
            stored++;
        } catch (e) {
            // Lost a race with a concurrent retry of the same message — fine.
            if ((e as { code?: string })?.code !== "P2002") throw e;
        }
    }
    return stored;
}

const STATUS_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };

/** Delivered / read / failed ticks for messages we sent. Never moves backwards. */
export async function applyStatuses(value: WaChangeValue): Promise<void> {
    for (const s of value.statuses ?? []) {
        if (!s.id || !s.status || !(s.status in STATUS_RANK)) continue;
        const row = await prisma.message.findUnique({
            where: { externalId: s.id },
            select: { id: true, status: true, billKind: true, billRefId: true },
        });
        if (!row) continue;
        if ((STATUS_RANK[row.status ?? ""] ?? 0) >= STATUS_RANK[s.status]) continue;
        const at = metaTime(s.timestamp);
        const error = s.status === "failed"
            ? (s.errors?.[0]?.message ?? s.errors?.[0]?.title ?? "failed").slice(0, 500)
            : null;
        await prisma.message.update({
            where: { id: row.id },
            data: {
                status: s.status,
                ...(s.status === "delivered" ? { deliveredAt: at } : {}),
                ...(s.status === "read" ? { readAt: at } : {}),
                ...(error ? { error } : {}),
            },
        });
        // The bill's own record shows a failed WhatsApp too.
        if (error && row.billKind && row.billRefId != null) {
            await prisma.billNotification.updateMany({
                where: { kind: row.billKind, refId: row.billRefId },
                data: { waStatus: "failed", waError: error },
            });
        }
    }
}

/** Record a bill message we just sent, so the customer's thread shows it. Never throws. */
export async function recordBillMessage(args: {
    mobile10: string;
    externalId: string;
    billKind: string;
    billRefId: number;
    body: string;
}): Promise<void> {
    try {
        await prisma.message.create({
            data: {
                channel: "WHATSAPP",
                direction: "OUT",
                phone: phoneMatchKey(args.mobile10),
                address: args.mobile10,
                kind: "template",
                body: args.body,
                externalId: args.externalId,
                billKind: args.billKind,
                billRefId: args.billRefId,
                status: "sent",
                occurredAt: new Date(),
            },
        });
    } catch (e) {
        console.error("[messages] could not record bill message", e);
    }
}

/** True while Meta still accepts a free-text reply to this number. */
export async function replyWindowOpen(phone: string): Promise<{ open: boolean; closesAt: Date | null }> {
    const last = await prisma.message.findFirst({
        where: { phone, direction: "IN" },
        orderBy: { occurredAt: "desc" },
        select: { occurredAt: true },
    });
    if (!last) return { open: false, closesAt: null };
    const closesAt = new Date(last.occurredAt.getTime() + REPLY_WINDOW_MS);
    return { open: closesAt.getTime() > Date.now(), closesAt };
}

export class ReplyRefusedError extends Error {}

/** Send a staff reply on WhatsApp and store it on the customer's thread. */
export async function sendReply(args: { phone: string; text: string; userId: number }) {
    if (!isBillSendConfigured()) throw new ReplyRefusedError("WhatsApp sending is not set up on this server.");
    const { open } = await replyWindowOpen(args.phone);
    if (!open) {
        throw new ReplyRefusedError("More than 24 hours since the customer last wrote. WhatsApp only allows an approved template now.");
    }
    const owner = (await ownersByPhone([args.phone])).get(args.phone) ?? null;
    const externalId = await sendTextMessage(args.phone, args.text);
    const ticketId = await openTicketForPhone(args.phone, owner);
    const row = await prisma.message.create({
        data: {
            channel: "WHATSAPP",
            direction: "OUT",
            phone: args.phone,
            address: args.phone,
            kind: "text",
            body: args.text,
            externalId,
            ticketId,
            sentByUserId: args.userId,
            status: "sent",
            occurredAt: new Date(),
        },
    });
    void publishChangeServer(["chat"]);
    return row;
}

/**
 * Raise a help ticket from a message, or join it to an existing ticket.
 * The message (and any later unlinked messages from the same number) carry it.
 */
export async function ticketFromMessage(messageId: number, userId: number, existingTicketId?: number | null) {
    const msg = await prisma.message.findUnique({
        where: { id: messageId },
        select: { id: true, phone: true, body: true, senderName: true, occurredAt: true },
    });
    if (!msg) throw new ReplyRefusedError("Message not found.");

    let ticketId = existingTicketId ?? null;
    if (ticketId == null) {
        const pipeline = await getHelpPipeline(prisma);
        const entry = pipeline?.statuses.find((s) => s.isEntryPoint) ?? pipeline?.statuses[0];
        if (!pipeline || !entry) throw new ReplyRefusedError("Help Desk pipeline is not set up.");
        const owner = msg.phone ? (await ownersByPhone([msg.phone])).get(msg.phone) ?? null : null;
        const author = await buildActorSnapshot(userId);
        const subject = msg.body.split("\n")[0].slice(0, 120) || "WhatsApp message";
        const ticket = await prisma.ticket.create({
            data: {
                sourceCounterId: await sourceCounterId(),
                pipelineId: pipeline.id,
                status: entry.id,
                title: subject,
                category: "OTHER",
                notes: msg.body,
                createdBy: author,
                help: {
                    create: {
                        contactName: owner?.name ?? msg.senderName ?? null,
                        phone: msg.phone,
                        personId: owner?.kind === "person" ? owner.id : null,
                        companyId: owner?.kind === "company" ? owner.id : null,
                        inquiryType: "OTHER",
                        subject,
                    },
                },
            },
            select: { id: true, status: true },
        });
        await prisma.ticketLog.create({
            data: { ticketId: ticket.id, status: ticket.status, note: "Help ticket raised from a WhatsApp message", author },
        });
        ticketId = ticket.id;
    }

    // This message, plus the later ones from the same number still unlinked.
    await prisma.message.updateMany({
        where: {
            OR: [
                { id: msg.id },
                ...(msg.phone ? [{ phone: msg.phone, ticketId: null, occurredAt: { gt: msg.occurredAt } }] : []),
            ],
        },
        data: { ticketId },
    });
    void publishChangeServer(["chat", "tickets"]);
    return ticketId;
}
