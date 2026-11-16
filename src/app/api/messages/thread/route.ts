import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { phoneMatchKey } from "@/shared/lib/format";
import { isMissedCall } from "@/shared/lib/calls";
import { ASSIGNED_POSITION_SELECT } from "@/shared/lib/api/ticketSelects";
import { officeLinksFor, officeTicketHref } from "@/modules/message/lib/messageLinks";
import { claimsByPhone, conversationsByPhone, mediaLink, menuAfterTemplateApplies, ownersByPhone, partyPhones, replyWindowOpen, setNumberSpam } from "@/modules/message/lib/customerMessages";

// /api/messages/thread?phone=<10 digits>
//
// GET   — one customer's thread: their messages and calls by time across
//         every number the party has (`numbers`; `phone` is the reply number), the
//         customer the number belongs to, the open conversation (topic) and its
//         ticket, and whether a free reply is still allowed. Read-only.
// PATCH — { phone, seen: true } marks their messages read;
//         { phone, spam: boolean } flags / clears the number and blocks /
//         unblocks it at Meta; answers { meta, metaError }.

const THREAD_LIMIT = 200;

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const phone = phoneMatchKey(new URL(req.url).searchParams.get("phone"));
        if (!phone) return NextResponse.json({ error: "phone is required" }, { status: 400 });

        // One customer, every number of theirs: shown as one chat. `phone` stays
        // the number replies, claim, conversation and spam act on.
        const customer = (await ownersByPhone([phone])).get(phone) ?? null;
        const phones = await partyPhones(phone, customer);
        const messages = await prisma.message.findMany({
            where: { phone: { in: phones } },
            orderBy: { occurredAt: "desc" },
            take: THREAD_LIMIT,
        });
        const oldest = messages[messages.length - 1]?.occurredAt;
        const [calls, window, claims, conversations] = await Promise.all([
            prisma.call.findMany({
                where: { phone: { in: phones }, spam: false, ...(oldest && messages.length === THREAD_LIMIT ? { occurredAt: { gte: oldest } } : {}) },
                orderBy: { occurredAt: "desc" },
                take: THREAD_LIMIT,
                select: { id: true, phone: true, direction: true, occurredAt: true, durationSec: true, speechSec: true, note: true },
            }),
            replyWindowOpen(phone),
            claimsByPhone([phone]),
            conversationsByPhone([phone]),
        ]);
        // The reply picker: each number that has messages, with when the
        // customer last wrote from it (the default reply goes to the latest).
        const lastIn = new Map<string, string>();
        for (const m of messages) if (m.direction === "IN" && m.phone && !lastIn.has(m.phone)) lastIn.set(m.phone, m.occurredAt.toISOString());
        const numbers = phones
            .filter((p) => p === phone || messages.some((m) => m.phone === p))
            .map((p) => ({ phone: p, lastInAt: lastIn.get(p) ?? null }));

        // The open conversation decides the ticket shown — never a guess from older messages.
        const conversation = conversations.get(phone) ?? null;
        const ticketId = conversation?.topic === "TICKET" ? conversation.ticketId : null;
        // Nothing open and the latest conversation was held back as a likely
        // auto-reply to our bill (AFTER_TEMPLATE): staff can still Close it (off
        // the popup) or, judging it real, send the ticket menu.
        const latestConv = conversation ? null : await prisma.messageConversation.findFirst({
            where: { phone },
            orderBy: { startedAt: "desc" },
            select: { closedReason: true },
        });
        const afterTemplate = latestConv?.closedReason === "AFTER_TEMPLATE";
        const menuAvailable = afterTemplate && (await menuAfterTemplateApplies(phone));
        const ticket = ticketId
            ? await prisma.ticket.findUnique({
                where: { id: ticketId },
                select: {
                    id: true, title: true, priority: true, pipelineId: true,
                    ticketStatus: { select: { label: true, color: true } },
                    assignedPosition: ASSIGNED_POSITION_SELECT,
                    repair: { select: { ticketId: true } },
                    deal: { select: { ticketId: true } },
                    help: { select: { ticketId: true } },
                },
            })
            : null;

        // Staff names for OUT replies — one query.
        const userIds = Array.from(new Set(messages.map((m) => m.sentByUserId).filter((v): v is number => v != null)));
        const users = userIds.length
            ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
            : [];
        const userName = new Map(users.map((u) => [u.id, u.name]));
        const links = await officeLinksFor(messages);

        const items = [
            ...messages.map((m) => ({
                type: "message" as const,
                id: m.id,
                at: m.occurredAt.toISOString(),
                phone: m.phone,
                channel: m.channel,
                direction: m.direction,
                kind: m.kind,
                body: m.body,
                senderName: m.senderName,
                businessNumber: m.businessNumber,
                // Signed, 1-hour links — the bucket itself is private.
                mediaUrl: mediaLink(m.mediaKey),
                downloadUrl: m.mediaKey ? mediaLink(m.mediaKey, m.fileName, true) : null,
                mediaType: m.mediaType,
                fileName: m.fileName,
                mediaSize: m.mediaSize,
                sentBy: m.sentByUserId != null ? (userName.get(m.sentByUserId) ?? "Staff") : null,
                billKind: m.billKind,
                billRefId: m.billRefId,
                billHref: m.billKind && m.billRefId != null ? (links.get(`bill:${m.billKind}:${m.billRefId}`) ?? null) : null,
                ticketId: m.ticketId,
                ticketHref: m.ticketId != null ? (links.get(`ticket:${m.ticketId}`) ?? null) : null,
                conversationId: m.conversationId,
                status: m.status,
                deliveredAt: m.deliveredAt?.toISOString() ?? null,
                readAt: m.readAt?.toISOString() ?? null,
                error: m.error,
                replyToExternalId: m.replyToExternalId,
            })),
            ...calls.map((c) => ({
                type: "call" as const,
                id: c.id,
                at: c.occurredAt.toISOString(),
                phone: c.phone,
                direction: c.direction,
                missed: isMissedCall(c.direction, c.speechSec, c.durationSec),
                durationSec: c.speechSec || c.durationSec,
                note: c.note,
            })),
        ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

        return NextResponse.json({
            phone,
            /** The customer's numbers in this chat — more than one shows the Reply-via picker. */
            numbers,
            customer,
            senderName: messages.find((m) => m.phone === phone && m.senderName)?.senderName ?? null,
            spam: messages.some((m) => m.phone === phone && m.spam),
            ticket: ticket
                ? {
                    id: ticket.id,
                    title: ticket.title,
                    priority: ticket.priority,
                    status: ticket.ticketStatus?.label ?? null,
                    assignee: ticket.assignedPosition?.holders.map((h) => h.user.name).join(", ") || ticket.assignedPosition?.title || null,
                    kind: ticket.repair ? "repair" : ticket.deal ? "deal" : "help",
                    href: officeTicketHref(ticket),
                }
                : null,
            claim: claims.get(phone) ?? null,
            conversation,
            afterTemplate,
            menuAvailable,
            replyWindow: { open: window.open, closesAt: window.closesAt?.toISOString() ?? null },
            items,
        });
    } catch (e) {
        return handleApiError(e, "Failed to load the conversation");
    }
}

const patchSchema = z.object({
    phone: z.string().trim().min(1),
    seen: z.literal(true).optional(),
    spam: z.boolean().optional(),
});

export async function PATCH(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, patchSchema);
        if (error) return error;
        const phone = phoneMatchKey(data.phone);
        if (!phone) return NextResponse.json({ error: "Not a valid number" }, { status: 400 });
        if (data.seen) {
            // Opening the chat reads every number of the customer — it is one chat on screen.
            await prisma.message.updateMany({ where: { phone: { in: await partyPhones(phone) }, direction: { in: ["IN", "NOTE"] }, seenAt: null }, data: { seenAt: new Date() } });
        }
        if (data.spam !== undefined) {
            return NextResponse.json({ ok: true, ...(await setNumberSpam(phone, data.spam)) });
        }
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to update the conversation");
    }
}
