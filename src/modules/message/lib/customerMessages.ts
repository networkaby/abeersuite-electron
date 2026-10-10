import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { phoneMatchKey, phoneKeyVariants } from "@/shared/lib/format";
import { getHelpPipeline } from "@/modules/help/lib/helpPipeline";
import { getDealsPipeline } from "@/modules/deals/lib/dealsPipeline";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";
import { sourceCounterId } from "@/shared/lib/counter/sourceCounter";
import {
    conversationNumberId,
    downloadWaMedia,
    isBillSendConfigured,
    sendMediaMessage,
    sendTextMessage,
    waMediaTypeFor,
} from "@/shared/lib/whatsapp/metaTemplates";
import { isR2Configured, presignR2, putR2 } from "@/shared/lib/storage/r2";
import {
    R2_MESSAGES_BUCKET,
    WA_KEEP_INBOUND_MAX_BYTES,
    WA_MEDIA_LINK_SECONDS,
    WA_SEND_LIMIT_BYTES,
    WA_TICKET_AUTO_REPLY_COOLDOWN_MS,
} from "@/shared/lib/constants/whatsapp";
import { publishChangeServer } from "@/shared/lib/realtime/serverPublish";
import { isAutoSend, getWaTemplateDraft } from "@/shared/lib/whatsapp/waTemplateStore";
import { fillBody } from "@/shared/lib/whatsapp/billTemplates";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { notifyDealCreated, notifyHelpCreated } from "@/shared/lib/whatsapp/notifyBill";

/**
 * Customer messages — the logic behind the Meta webhook and the Messages screen.
 *
 * A message is treated like a phone call (see prisma/schema/messages.prisma):
 * always a customer's, matched BY PHONE at read time; sometimes a ticket's;
 * sometimes a bill's. Everything here keys on the 10-digit `phone` match key.
 */

/** Meta allows free text only this long after the customer's last message. */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export type CustomerOwner = {
    kind: "person" | "company";
    id: number;
    name: string;
    avatarUrl?: string | null;
    address?: string | null;
    accountId?: number | null;
    balance?: number | null;
    normalBalance?: "DEBIT" | "CREDIT" | null;
};

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
            person: {
                select: {
                    id: true,
                    name: true,
                    avatarUrl: true,
                    address: true,
                    account: { select: { id: true, balance: true, normalBalance: true } },
                },
            },
            company: {
                select: {
                    id: true,
                    name: true,
                    address: true,
                    account: { select: { id: true, balance: true, normalBalance: true } },
                },
            },
        },
    });
    for (const row of rows) {
        const key = phoneMatchKey(row.phone);
        if (!key || owners.has(key)) continue;
        if (row.person) {
            owners.set(key, {
                kind: "person",
                id: row.person.id,
                name: row.person.name,
                avatarUrl: row.person.avatarUrl,
                address: row.person.address,
                accountId: row.person.account?.id ?? null,
                balance: row.person.account ? Number(row.person.account.balance) : null,
                normalBalance: (row.person.account?.normalBalance as "DEBIT" | "CREDIT") ?? null,
            });
        } else if (row.company) {
            owners.set(key, {
                kind: "company",
                id: row.company.id,
                name: row.company.name,
                avatarUrl: null,
                address: row.company.address,
                accountId: row.company.account?.id ?? null,
                balance: row.company.account ? Number(row.company.account.balance) : null,
                normalBalance: (row.company.account?.normalBalance as "DEBIT" | "CREDIT") ?? null,
            });
        }
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

export type ActiveTicketSummary = {
    id: number;
    title: string;
    pipelineName: string;
    statusLabel: string;
    kind: "repair" | "deal" | "help" | "order" | "ticket";
};

/**
 * Find active (unclosed) tickets and deals for a customer across repair, deal, help, and orders.
 * Returns up to 3 most recently updated items.
 */
export async function findCustomerActiveTickets(
    phone: string,
    owner: CustomerOwner | null
): Promise<ActiveTicketSummary[]> {
    const orConditions: Record<string, unknown>[] = [
        { deal: { phone: { endsWith: phone } } },
        { help: { phone: { endsWith: phone } } },
        { order: { guestPhone: { endsWith: phone } } },
    ];
    if (owner?.accountId) {
        orConditions.push({ accountId: owner.accountId });
        orConditions.push({ repair: { device: { accountId: owner.accountId } } });
    }
    if (owner?.kind === "person") {
        orConditions.push({ deal: { personId: owner.id } });
        orConditions.push({ help: { personId: owner.id } });
        orConditions.push({ order: { personId: owner.id } });
    } else if (owner?.kind === "company") {
        orConditions.push({ deal: { companyId: owner.id } });
        orConditions.push({ help: { companyId: owner.id } });
    }

    const tickets = await prisma.ticket.findMany({
        where: {
            closedAt: null,
            OR: orConditions,
        },
        orderBy: { updatedAt: "desc" },
        take: 3,
        select: {
            id: true,
            title: true,
            pipeline: { select: { name: true } },
            ticketStatus: { select: { label: true } },
            repair: {
                select: {
                    ticketNo: true,
                    device: { select: { type: true, brand: true, model: true } },
                },
            },
            deal: { select: { contactName: true } },
            help: { select: { subject: true } },
            order: { select: { legacyStatus: true } },
        },
    });

    return tickets.map((t) => {
        let kind: ActiveTicketSummary["kind"] = "ticket";
        let displayTitle = t.title || "Inquiry";
        if (t.repair) {
            kind = "repair";
            const dev = t.repair.device;
            const devDesc = [dev?.brand, dev?.model].filter(Boolean).join(" ");
            displayTitle = devDesc ? `${devDesc} Repair` : (t.repair.ticketNo ? `Repair #${t.repair.ticketNo}` : (t.title || "Device Repair"));
        } else if (t.deal) {
            kind = "deal";
            displayTitle = t.title || "Sales Deal";
        } else if (t.help) {
            kind = "help";
            displayTitle = t.help.subject || t.title || "Support Request";
        } else if (t.order) {
            kind = "order";
            displayTitle = t.title || `Order #${t.id}`;
        }

        return {
            id: t.id,
            title: displayTitle,
            pipelineName: t.pipeline?.name || "Support",
            statusLabel: t.ticketStatus?.label || "Active",
            kind,
        };
    });
}

const NUM_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣"];

/** Build the WhatsApp interactive numbered auto-reply menu for a customer with active tickets. */
export function buildTicketAutoReplyMenu(
    customerName: string | null,
    tickets: ActiveTicketSummary[],
    customGreetingHeader?: string
): string {
    const brand = getOrganisation().brandName;
    const defaultGreeting = customerName
        ? `Hello *${customerName}*, welcome back to ${brand}! 👋`
        : `Hello, welcome back to ${brand}! 👋`;
    const greeting = customGreetingHeader?.trim() || defaultGreeting;

    if (tickets.length === 1) {
        const t = tickets[0];
        const kindLabel = t.kind === "repair" ? "Repair" : t.kind === "deal" ? "Deal" : "Ticket";
        return `${greeting}

You currently have an active job with us:
📌 *${kindLabel} #${t.id}* — ${t.title} _(${t.statusLabel})_

1️⃣ Yes, my message is about this ${t.kind === "repair" ? "repair" : "ticket"}
2️⃣ No, I want to discuss something new

👉 _Please reply with 1 or 2._`;
    }

    const options = tickets.map((t, idx) => {
        const emoji = NUM_EMOJIS[idx] || `${idx + 1}️⃣`;
        const kindLabel = t.kind === "repair" ? "Repair" : t.kind === "deal" ? "Deal" : "Ticket";
        return `${emoji} *${kindLabel} #${t.id}* — ${t.title} _(${t.statusLabel})_`;
    });
    const nextEmoji = NUM_EMOJIS[tickets.length] || `${tickets.length + 1}️⃣`;
    options.push(`${nextEmoji} Something new / Speak with our support team`);

    const choices = Array.from({ length: tickets.length + 1 }, (_, i) => String(i + 1)).join(", ");

    return `${greeting}

We noticed you have active job(s) with us. Please let us know what your message is about:

${options.join("\n")}

👉 _Please reply with ${choices}._`;
}

/** Check if the customer's incoming message is replying to our ticket auto-reply menu. */
async function checkTicketMenuReply(args: {
    phone: string;
    text: string;
    owner: CustomerOwner | null;
}): Promise<{ handled: boolean; ticketId: number | null; ackText: string }> {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const lastOut = await prisma.message.findFirst({
        where: { phone: args.phone, direction: "OUT" },
        orderBy: { occurredAt: "desc" },
        select: { id: true, body: true, occurredAt: true },
    });
    if (!lastOut || lastOut.occurredAt < twoHoursAgo || !lastOut.body.includes("👉 _Please reply with")) {
        return { handled: false, ticketId: null, ackText: "" };
    }

    const match = args.text.trim().match(/^([1-4])(?:[.\-)]|\s+|$)\s*([\s\S]*)$/);
    if (!match) return { handled: false, ticketId: null, ackText: "" };

    const choice = parseInt(match[1], 10);
    const extraText = match[2]?.trim() || "";
    const activeTickets = await findCustomerActiveTickets(args.phone, args.owner);
    if (!activeTickets.length) return { handled: false, ticketId: null, ackText: "" };

    let routedTicketId: number | null = null;
    let ackText = "";

    if (activeTickets.length === 1) {
        const t = activeTickets[0];
        const kindLabel = t.kind === "repair" ? "Repair" : "Ticket";
        if (choice === 1) {
            routedTicketId = t.id;
            ackText = extraText
                ? `✅ Thank you! Your message has been connected to *${kindLabel} #${t.id}* (${t.title}). Our team will update you shortly.`
                : `✅ Thank you! You are now connected to *${kindLabel} #${t.id}* (${t.title}). Please let us know how we can help you with this.`;
        } else if (choice === 2) {
            routedTicketId = null;
            ackText = extraText
                ? `✅ Got it! Your message has been received by our support team. An executive will attend to you shortly.`
                : `✅ Got it! Please tell us how we can help you today, and an executive will assist you.`;
        } else {
            return { handled: false, ticketId: null, ackText: "" };
        }
    } else {
        if (choice >= 1 && choice <= activeTickets.length) {
            const t = activeTickets[choice - 1];
            const kindLabel = t.kind === "repair" ? "Repair" : "Ticket";
            routedTicketId = t.id;
            ackText = extraText
                ? `✅ Thank you! Your message has been connected to *${kindLabel} #${t.id}* (${t.title}). Our team will update you shortly.`
                : `✅ Thank you! You are now connected to *${kindLabel} #${t.id}* (${t.title}). Please let us know how we can help you with this.`;
        } else if (choice === activeTickets.length + 1) {
            routedTicketId = null;
            ackText = extraText
                ? `✅ Got it! Your message has been received by our support team. An executive will attend to you shortly.`
                : `✅ Got it! Please tell us how we can help you today, and an executive will assist you.`;
        } else {
            return { handled: false, ticketId: null, ackText: "" };
        }
    }

    return { handled: true, ticketId: routedTicketId, ackText };
}

/** Send the acknowledgment confirmation after the customer made a menu selection. */
async function sendMenuAcknowledgment(args: {
    phone: string;
    ticketId: number | null;
    text: string;
    businessNumberId: string | null;
}): Promise<void> {
    if (!isBillSendConfigured() || !args.text) return;
    const fromNumberId = args.businessNumberId || conversationNumberId() || null;
    try {
        const extId = await sendTextMessage(args.phone, args.text, fromNumberId);
        await prisma.message.create({
            data: {
                channel: "WHATSAPP",
                direction: "OUT",
                phone: args.phone,
                address: args.phone,
                businessNumberId: fromNumberId,
                kind: "text",
                body: args.text,
                externalId: extId,
                ticketId: args.ticketId,
                status: "sent",
                occurredAt: new Date(),
            },
        });
    } catch (e) {
        console.error("[messages] could not send menu acknowledgment", e);
    }
}

/**
 * Send the ticket auto-reply menu if this customer has active tickets/deals
 * and has not had an interaction with us in the last 6 hours (cooldown).
 */
async function maybeSendTicketAutoReplyMenu(args: {
    phone: string;
    owner: CustomerOwner | null;
    senderName: string | null;
    businessNumberId: string | null;
}): Promise<void> {
    if (!isBillSendConfigured()) return;

    const autoSendOn = await isAutoSend("TICKET_AUTO_REPLY");
    if (!autoSendOn) return;

    const activeTickets = await findCustomerActiveTickets(args.phone, args.owner);
    if (!activeTickets.length) return;

    const cutoff = new Date(Date.now() - WA_TICKET_AUTO_REPLY_COOLDOWN_MS);
    const recentOut = await prisma.message.findFirst({
        where: { phone: args.phone, direction: "OUT", occurredAt: { gte: cutoff } },
        select: { id: true },
    });
    if (recentOut) return;

    const customerName = args.owner?.name ?? args.senderName ?? null;
    const draft = await getWaTemplateDraft("TICKET_AUTO_REPLY");
    const greetingHeader = fillBody(draft.body, {
        customer: customerName ?? "there",
        shop: getOrganisation().brandName,
    });
    const menuText = buildTicketAutoReplyMenu(customerName, activeTickets, greetingHeader);
    const fromNumberId = args.businessNumberId || conversationNumberId() || null;

    try {
        const extId = await sendTextMessage(args.phone, menuText, fromNumberId);
        await prisma.message.create({
            data: {
                channel: "WHATSAPP",
                direction: "OUT",
                phone: args.phone,
                address: args.phone,
                businessNumberId: fromNumberId,
                kind: "text",
                body: menuText,
                externalId: extId,
                status: "sent",
                occurredAt: new Date(),
            },
        });
    } catch (e) {
        console.error("[messages] could not send ticket auto-reply menu", e);
    }
}

/**
 * Record a message directly into the ticket's activity timeline (TicketLog).
 * Keeps ticket history authoritative and informative across repairs, deals, and helpdesk.
 */
async function logMessageToTicket(args: {
    ticketId: number;
    authorName: string;
    text: string;
    direction: "IN" | "OUT";
    occurredAt?: Date;
    userId?: number;
}): Promise<void> {
    if (!args.ticketId || !args.text) return;
    try {
        const isOut = args.direction === "OUT";
        const prefix = isOut ? `💬 WhatsApp (Staff - ${args.authorName}): ` : `💬 WhatsApp (${args.authorName}): `;
        await prisma.ticketLog.create({
            data: {
                ticketId: args.ticketId,
                kind: "NOTE",
                visibility: "PUBLIC",
                note: `${prefix}${args.text}`,
                author: { userName: args.authorName, userId: args.userId, channel: "WHATSAPP" },
                createdAt: args.occurredAt ?? new Date(),
            },
        });
    } catch (e) {
        // Non-blocking log creation
        console.error("[messages] could not log message to ticket", e);
    }
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
    image?: { id?: string; caption?: string };
    video?: { id?: string; caption?: string };
    audio?: { id?: string; voice?: boolean };
    sticker?: { id?: string };
    document?: { id?: string; caption?: string; filename?: string };
    location?: { name?: string; address?: string };
};
type WaStatus = {
    id: string;
    status?: string;
    timestamp?: string;
    errors?: { title?: string; message?: string }[];
};
export type WaChangeValue = {
    /** Which of our numbers the change is for. */
    metadata?: { phone_number_id?: string; display_phone_number?: string };
    contacts?: { wa_id?: string; profile?: { name?: string } }[];
    messages?: WaInbound[];
    statuses?: WaStatus[];
};

function metaTime(ts: string | undefined): Date {
    const n = Number(ts);
    return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
}

/** What a message says, as one line of text (the list preview). A file's own
 *  content is kept separately — see keepInboundMedia. */
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

type MediaFields = { mediaKey: string | null; mediaType: string | null; fileName: string | null; mediaSize: number | null };
const NO_MEDIA: MediaFields = { mediaKey: null, mediaType: null, fileName: null, mediaSize: null };

/**
 * Copy a customer's attachment from Meta into our private R2 bucket. Meta's
 * own download link expires, so this is done once, as the message arrives.
 * Never throws: a failed copy still stores the message, just without the file.
 */
async function keepInboundMedia(m: WaInbound): Promise<MediaFields> {
    const mediaId = m.image?.id ?? m.video?.id ?? m.audio?.id ?? m.sticker?.id ?? m.document?.id;
    if (!mediaId || !isR2Configured()) return NO_MEDIA;
    try {
        const file = await downloadWaMedia(mediaId);
        if (file.size > WA_KEEP_INBOUND_MAX_BYTES) return { ...NO_MEDIA, mediaType: file.mime, mediaSize: file.size };
        const key = `in/${new Date().toISOString().slice(0, 7)}/${m.id.replace(/[^A-Za-z0-9_-]/g, "")}${extFor(file.mime, m.document?.filename)}`;
        await putR2(R2_MESSAGES_BUCKET, key, file.bytes, file.mime);
        return { mediaKey: key, mediaType: file.mime, fileName: m.document?.filename ?? null, mediaSize: file.size };
    } catch (e) {
        console.error("[messages] could not keep attachment", m.id, e);
        return NO_MEDIA;
    }
}

const EXT: Record<string, string> = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "video/mp4": ".mp4", "video/3gpp": ".3gp",
    "audio/ogg": ".ogg", "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/aac": ".aac", "audio/amr": ".amr",
    "application/pdf": ".pdf",
};
function extFor(mime: string, fileName?: string | null): string {
    const fromName = fileName?.match(/\.[A-Za-z0-9]{1,8}$/)?.[0];
    return (fromName ?? EXT[mime] ?? "").toLowerCase();
}

/**
 * A short-lived link to show / download an attachment. Null when R2 is off.
 * Signed as of the start of the current window and valid for two windows, so
 * every thread reload in that window gets the SAME URL — the browser serves the
 * photo from its cache instead of downloading it again — and a link handed out
 * late in a window still has at least one full window left.
 */
export function mediaLink(key: string | null, fileName?: string | null, download = false): string | null {
    if (!key || !isR2Configured()) return null;
    const windowMs = WA_MEDIA_LINK_SECONDS * 1000;
    return presignR2({
        bucket: R2_MESSAGES_BUCKET, key, method: "GET", expiresSec: WA_MEDIA_LINK_SECONDS * 2,
        signedAt: new Date(Math.floor(Date.now() / windowMs) * windowMs),
        cacheSeconds: WA_MEDIA_LINK_SECONDS,
        downloadName: download ? fileName ?? key.split("/").pop() : undefined,
    });
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
        let ticketId = phone && !spam ? await openTicketForPhone(phone, owner) : null;
        let menuAck: { ticketId: number | null; ackText: string } | null = null;

        if (phone && !spam) {
            const menuReply = await checkTicketMenuReply({
                phone,
                text: inboundBody(m),
                owner,
            });
            if (menuReply.handled) {
                ticketId = menuReply.ticketId;
                menuAck = { ticketId: menuReply.ticketId, ackText: menuReply.ackText };
            }
        }

        const media = await keepInboundMedia(m);

        try {
            await prisma.message.create({
                data: {
                    channel: "WHATSAPP",
                    direction: "IN",
                    phone,
                    address: m.from,
                    senderName: names.get(m.from) ?? null,
                    businessNumberId: value.metadata?.phone_number_id ?? null,
                    businessNumber: value.metadata?.display_phone_number ?? null,
                    kind: m.type ?? "text",
                    body: inboundBody(m),
                    ...media,
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

            if (ticketId && phone && !spam) {
                const senderName = names.get(m.from) ?? owner?.name ?? "Customer";
                const bodyText = inboundBody(m);
                if (bodyText) {
                    await logMessageToTicket({
                        ticketId,
                        authorName: senderName,
                        text: bodyText,
                        direction: "IN",
                        occurredAt: metaTime(m.timestamp),
                    });
                }
            }

            if (menuAck) {
                await sendMenuAcknowledgment({
                    phone: phone!,
                    ticketId: menuAck.ticketId,
                    text: menuAck.ackText,
                    businessNumberId: value.metadata?.phone_number_id ?? null,
                });
            } else if (phone && !spam) {
                await maybeSendTicketAutoReplyMenu({
                    phone,
                    owner,
                    senderName: names.get(m.from) ?? null,
                    businessNumberId: value.metadata?.phone_number_id ?? null,
                });
            }
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
        const isTicketMsg = args.billKind.startsWith("REPAIR_") || args.billKind === "DEAL_CREATED" || args.billKind === "HELP_CREATED";
        const ticketId = isTicketMsg ? args.billRefId : null;
        await prisma.message.create({
            data: {
                channel: "WHATSAPP",
                direction: "OUT",
                phone: phoneMatchKey(args.mobile10),
                address: args.mobile10,
                businessNumberId: conversationNumberId() ?? null,
                kind: "template",
                body: args.body,
                externalId: args.externalId,
                billKind: args.billKind,
                billRefId: args.billRefId,
                ticketId,
                status: "sent",
                occurredAt: new Date(),
            },
        });
        if (ticketId) {
            await logMessageToTicket({
                ticketId,
                authorName: "System",
                text: args.body,
                direction: "OUT",
                occurredAt: new Date(),
            });
        }
    } catch (e) {
        console.error("[messages] could not record bill message", e);
    }
}

/**
 * True while Meta still accepts a free-text reply to this customer. The window
 * belongs to the pair (our number, customer), so it is read off the customer's
 * latest message — and that message's number is the one the reply goes from.
 */
export async function replyWindowOpen(phone: string): Promise<{ open: boolean; closesAt: Date | null; fromNumberId: string | null }> {
    const last = await prisma.message.findFirst({
        where: { phone, direction: "IN" },
        orderBy: { occurredAt: "desc" },
        select: { occurredAt: true, businessNumberId: true },
    });
    if (!last) return { open: false, closesAt: null, fromNumberId: null };
    const closesAt = new Date(last.occurredAt.getTime() + REPLY_WINDOW_MS);
    return { open: closesAt.getTime() > Date.now(), closesAt, fromNumberId: last.businessNumberId };
}

export class ReplyRefusedError extends Error {}

export type OutgoingMedia = { key: string; type: string; name: string; size: number };

/** Where a staff upload goes. Keys are ours, so a reply can only attach a file
 *  this server handed out an upload link for (prefix + phone checked). */
export function outgoingMediaKey(phone: string, fileName: string): string {
    const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80) || "file";
    return `out/${phone}/${Date.now().toString(36)}-${safe}`;
}

/** Refuse a file Meta would refuse, before anything is uploaded. */
export function checkOutgoingMedia(type: string, size: number): string | null {
    const limit = WA_SEND_LIMIT_BYTES[waMediaTypeFor(type)];
    if (size <= 0) return "Empty file.";
    if (size > limit) return `File is too large for WhatsApp (max ${Math.round(limit / 1024 / 1024)} MB for this kind).`;
    return null;
}

/** Send a staff reply on WhatsApp and store it on the customer's thread. */
export async function sendReply(args: { phone: string; text: string; userId: number; media?: OutgoingMedia | null }) {
    if (!isBillSendConfigured()) throw new ReplyRefusedError("WhatsApp sending is not set up on this server.");
    const { open, fromNumberId } = await replyWindowOpen(args.phone);
    if (!open) {
        throw new ReplyRefusedError("More than 24 hours since the customer last wrote. WhatsApp only allows an approved template now.");
    }
    const owner = (await ownersByPhone([args.phone])).get(args.phone) ?? null;
    // Old rows carry no number = the main one, the only one back then.
    const from = fromNumberId ?? process.env.META_WA_PHONE_NUMBER_ID ?? null;
    const media = args.media ?? null;
    if (media) {
        if (!isR2Configured()) throw new ReplyRefusedError("File storage (R2) is not set up on this server.");
        if (!media.key.startsWith(`out/${args.phone}/`)) throw new ReplyRefusedError("That file does not belong to this chat.");
        const bad = checkOutgoingMedia(media.type, media.size);
        if (bad) throw new ReplyRefusedError(bad);
    }
    const externalId = media
        ? await sendMediaMessage({
            mobile10: args.phone,
            link: mediaLink(media.key)!,
            mime: media.type,
            caption: args.text || null,
            fileName: media.name,
            fromNumberId: from,
        })
        : await sendTextMessage(args.phone, args.text, from);
    const ticketId = await openTicketForPhone(args.phone, owner);
    const row = await prisma.message.create({
        data: {
            channel: "WHATSAPP",
            direction: "OUT",
            phone: args.phone,
            address: args.phone,
            businessNumberId: from,
            kind: media ? waMediaTypeFor(media.type) : "text",
            body: media ? (args.text ? `[${waMediaTypeFor(media.type)}] ${args.text}` : `[${waMediaTypeFor(media.type)}]`) : args.text,
            ...(media ? { mediaKey: media.key, mediaType: media.type, fileName: media.name, mediaSize: media.size } : {}),
            externalId,
            ticketId,
            sentByUserId: args.userId,
            status: "sent",
            occurredAt: new Date(),
        },
    });
    if (ticketId) {
        const staffUser = await prisma.user.findUnique({ where: { id: args.userId }, select: { name: true } });
        await logMessageToTicket({
            ticketId,
            authorName: staffUser?.name ?? "Staff",
            text: args.text || (media ? `[${waMediaTypeFor(media.type)}]` : "Message"),
            direction: "OUT",
            userId: args.userId,
        });
    }
    // A reply answers what the customer wrote: their messages are read for the
    // whole shop, so the new-message popup closes everywhere.
    await prisma.message.updateMany({
        where: { phone: args.phone, direction: { in: ["IN", "NOTE"] }, seenAt: null },
        data: { seenAt: new Date() },
    });
    // Replying puts you in the conversation: the first to reply owns it, anyone
    // else who replies joins as a helper, so the customer's next message pops
    // up for them too.
    const claim = await prisma.messageClaim.findUnique({ where: { phone: args.phone } });
    if (!claim) {
        await prisma.messageClaim.create({ data: { phone: args.phone, ownerUserId: args.userId } });
    } else if (claim.ownerUserId !== args.userId && !claim.helperUserIds.includes(args.userId)) {
        await prisma.messageClaim.update({
            where: { phone: args.phone },
            data: { helperUserIds: [...claim.helperUserIds, args.userId] },
        });
    }
    void publishChangeServer(["messages"]);
    return row;
}

/**
 * A staff note on a customer's chat that @mentions colleagues — never sent to
 * the customer. Stored as a Message with direction "NOTE" (seenAt = when a
 * mentioned person dealt with it). The chat passes to the people mentioned:
 * the first becomes owner, the rest helpers, and the writer steps OUT — no more
 * popups for them until someone mentions them back.
 */
export async function addMentionNote(args: { phone: string; text: string; userId: number; mentionIds: number[] }) {
    const ids = Array.from(new Set(args.mentionIds.filter((id) => id !== args.userId)));
    if (!ids.length) throw new ReplyRefusedError("Mention a colleague (type @ and pick a name).");
    const row = await prisma.message.create({
        data: {
            channel: "WHATSAPP",
            direction: "NOTE",
            phone: args.phone,
            kind: "note",
            body: args.text,
            sentByUserId: args.userId,
            occurredAt: new Date(),
        },
    });
    await prisma.messageClaim.upsert({
        where: { phone: args.phone },
        create: { phone: args.phone, ownerUserId: ids[0], helperUserIds: ids.slice(1) },
        update: { ownerUserId: ids[0], helperUserIds: ids.slice(1) },
    });
    void publishChangeServer(["messages"]);
    return row;
}

// ── Who is handling a chat (MessageClaim) ─────────────────────────────────────────

export type ClaimView = {
    owner: { id: number; name: string };
    helpers: { id: number; name: string }[];
    /** When the chat last changed hands — the 10-minute hand-back counts from here too. */
    since: string;
};

/** Each number's claim with staff names — one query for the claims, one for the names. */
export async function claimsByPhone(phones: string[]): Promise<Map<string, ClaimView>> {
    const out = new Map<string, ClaimView>();
    const unique = Array.from(new Set(phones.filter(Boolean)));
    if (!unique.length) return out;
    const claims = await prisma.messageClaim.findMany({ where: { phone: { in: unique } } });
    if (!claims.length) return out;
    const ids = Array.from(new Set(claims.flatMap((c) => [c.ownerUserId, ...c.helperUserIds])));
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    const name = new Map(users.map((u) => [u.id, u.name]));
    for (const c of claims) {
        out.set(c.phone, {
            owner: { id: c.ownerUserId, name: name.get(c.ownerUserId) ?? "Staff" },
            helpers: c.helperUserIds.map((id) => ({ id, name: name.get(id) ?? "Staff" })),
            since: c.updatedAt.toISOString(),
        });
    }
    return out;
}

export type ClaimAction =
    | { action: "take" }
    | { action: "leave" }
    | { action: "invite"; userId: number }
    | { action: "handover"; userId: number };

/**
 * Change who handles a chat. "take" makes the caller owner (the old owner stays
 * on as a helper, so nobody silently loses a chat they were in); "handover"
 * passes ownership to someone else; "invite" adds a helper; "leave" takes the
 * caller off the helpers.
 */
export async function changeClaim(phone: string, callerId: number, a: ClaimAction): Promise<void> {
    const cur = await prisma.messageClaim.findUnique({ where: { phone } });
    const helpers = new Set(cur?.helperUserIds ?? []);
    let owner = cur?.ownerUserId ?? null;

    if (a.action === "take" || a.action === "handover") {
        const next = a.action === "take" ? callerId : a.userId;
        if (owner != null && owner !== next) helpers.add(owner);
        helpers.delete(next);
        owner = next;
    } else if (a.action === "invite") {
        if (owner == null) owner = callerId;
        if (a.userId !== owner) helpers.add(a.userId);
    } else {
        helpers.delete(callerId);
        if (!cur) return;
    }

    await prisma.messageClaim.upsert({
        where: { phone },
        create: { phone, ownerUserId: owner!, helperUserIds: [...helpers] },
        update: { ownerUserId: owner!, helperUserIds: [...helpers] },
    });
    void publishChangeServer(["messages"]);
}

/**
 * Raise a help or deal ticket from a message, or join it to an existing ticket.
 * Maps the conversation's unlinked messages to the ticket and logs them into ticket history.
 */
export async function ticketFromMessage(
    messageId: number,
    userId: number,
    existingTicketId?: number | null,
    kind: "help" | "deal" = "help"
) {
    const msg = await prisma.message.findUnique({
        where: { id: messageId },
        select: { id: true, phone: true, body: true, senderName: true, occurredAt: true },
    });
    if (!msg) throw new ReplyRefusedError("Message not found.");

    let ticketId = existingTicketId ?? null;
    const owner = msg.phone ? (await ownersByPhone([msg.phone])).get(msg.phone) ?? null : null;
    const author = await buildActorSnapshot(userId);

    if (ticketId == null) {
        if (kind === "deal") {
            const pipeline = await getDealsPipeline(prisma);
            const entry = pipeline?.statuses.find((s) => s.isEntryPoint) ?? pipeline?.statuses[0];
            if (!pipeline || !entry) throw new ReplyRefusedError("Deals pipeline is not set up.");
            const subject = msg.body.split("\n")[0].slice(0, 120) || "WhatsApp lead";
            const ticket = await prisma.ticket.create({
                data: {
                    sourceCounterId: await sourceCounterId(),
                    pipelineId: pipeline.id,
                    status: entry.id,
                    title: subject,
                    priority: "MEDIUM",
                    notes: msg.body,
                    createdBy: author,
                    deal: {
                        create: {
                            contactName: owner?.name ?? msg.senderName ?? null,
                            phone: msg.phone,
                            personId: owner?.kind === "person" ? owner.id : null,
                            companyId: owner?.kind === "company" ? owner.id : null,
                            source: "WHATSAPP",
                        },
                    },
                },
                select: { id: true, status: true },
            });
            await prisma.ticketLog.create({
                data: { ticketId: ticket.id, status: ticket.status, note: "Deal lead created from a WhatsApp message", author },
            });
            ticketId = ticket.id;
            void notifyDealCreated(ticket.id).catch((err) => console.error("[notify-deal] error:", err));
        } else {
            const pipeline = await getHelpPipeline(prisma);
            const entry = pipeline?.statuses.find((s) => s.isEntryPoint) ?? pipeline?.statuses[0];
            if (!pipeline || !entry) throw new ReplyRefusedError("Help Desk pipeline is not set up.");
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
            void notifyHelpCreated(ticket.id).catch((err) => console.error("[notify-help] error:", err));
        }
    }

    // Map this message plus all other unlinked messages in this conversation to the ticket
    if (msg.phone) {
        const unlinkedMsgs = await prisma.message.findMany({
            where: {
                phone: msg.phone,
                ticketId: null,
            },
            orderBy: { occurredAt: "asc" },
            select: { id: true, direction: true, body: true, senderName: true, sentByUserId: true, occurredAt: true },
        });

        for (const m of unlinkedMsgs) {
            const isOut = m.direction === "OUT";
            let authorName = isOut ? "Staff" : (m.senderName ?? owner?.name ?? "Customer");
            if (isOut && m.sentByUserId) {
                const u = await prisma.user.findUnique({ where: { id: m.sentByUserId }, select: { name: true } });
                if (u?.name) authorName = u.name;
            }
            await logMessageToTicket({
                ticketId,
                authorName,
                text: m.body,
                direction: m.direction as "IN" | "OUT",
                occurredAt: m.occurredAt,
                userId: m.sentByUserId ?? undefined,
            });
        }

        await prisma.message.updateMany({
            where: {
                OR: [
                    { id: msg.id },
                    { phone: msg.phone, ticketId: null },
                ],
            },
            data: { ticketId },
        });
    } else {
        await prisma.message.update({
            where: { id: msg.id },
            data: { ticketId },
        });
    }

    void publishChangeServer(["messages", "tickets"]);
    return ticketId;
}
