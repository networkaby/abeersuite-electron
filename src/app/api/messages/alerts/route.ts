import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { claimsByPhone, mediaLink, ownersByPhone } from "@/modules/message/lib/customerMessages";
import { lastContactByPhone } from "@/shared/lib/calls/followUp";
import { CALL_POPUP_MAX_AGE_MS, MESSAGE_FOLLOWUP_START, MESSAGE_REPLY_WINDOW_MS } from "@/shared/lib/constants/polling";

// GET /api/messages/alerts — what the new-message popup shows, one row per
// number, plus who is handling it. A customer's message is handled like a call:
// it WAITS until the shop gets back to them — a reply, a ticket from the chat, a
// logged call, a Reconnect activity or a visit (lastContactByPhone). Opening
// the chat does not answer it. Waiting rows reach back CALL_POPUP_MAX_AGE_MS
// (never before MESSAGE_FOLLOWUP_START — older chats are not raised); an
// answered chat stays (`waiting: false`) for MESSAGE_REPLY_WINDOW_MS after the
// customer's last message, so staff can watch for a follow-up and close it.
// Plus every unanswered staff @mention note of the last day — a mention only
// passes the chat on, it never answers the customer. A customer message from
// before a staff Close is dropped altogether — Close is how staff clear a chat
// that needs no answer (a shop's auto-reply to our bill).
//
// The popup decides per staff member who sees which row (owner and helpers at
// once, everyone after MESSAGE_CLAIM_FALLBACK_MS for a waiting customer), so
// one answer serves the whole shop. Read on a realtime signal, never a timer.

const SCAN = 300;
/** Customer messages a popup card shows, newest last. */
const RECENT = 3;

/** One customer message on a card, with its attachment as a signed 1-hour link. */
type Recent = { body: string; mediaUrl: string | null; downloadUrl: string | null; mediaType: string | null; fileName: string | null; mediaSize: number | null };

type Chat = {
    phone: string;
    lastId: number;
    /** Newest customer message — what a ticket is raised from. */
    lastInId: number | null;
    recent: Recent[];
    senderName: string | null;
    lastAt: Date;
    /** Newest customer message's time — WhatsApp's 24-hour reply window runs from it. */
    lastInAt: Date | null;
    /** Oldest customer message still waiting — null when none is. */
    firstAt: Date | null;
    count: number;
    note: { by: string; text: string; at: string } | null;
};

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const now = Date.now();
        const from = new Date(Math.max(now - CALL_POPUP_MAX_AGE_MS, MESSAGE_FOLLOWUP_START.getTime()));
        const [inRows, notes] = await Promise.all([
            prisma.message.findMany({
                where: { direction: "IN", spam: false, phone: { not: null }, occurredAt: { gte: from } },
                orderBy: { occurredAt: "desc" },
                take: SCAN,
                select: { id: true, phone: true, body: true, senderName: true, occurredAt: true, mediaKey: true, mediaType: true, fileName: true, mediaSize: true },
            }),
            prisma.message.findMany({
                where: { direction: "NOTE", kind: { not: "ticket" }, seenAt: null, phone: { not: null }, occurredAt: { gte: new Date(now - MESSAGE_REPLY_WINDOW_MS) } },
                orderBy: { occurredAt: "desc" },
                take: SCAN,
                select: { id: true, phone: true, body: true, occurredAt: true, sentByUserId: true },
            }),
        ]);

        const phonesSeen = [...new Set([...inRows, ...notes].map((r) => r.phone!))];
        const owners = await ownersByPhone(phonesSeen);
        const [contact, closes] = await Promise.all([
            lastContactByPhone(phonesSeen, owners, { since: from, visits: true }),
            // Staff Close (or the customer's /new) clears the chat off the popup.
            // A TIMEOUT or AFTER_TEMPLATE close is conversation mapping, not that.
            prisma.messageConversation.groupBy({
                by: ["phone"],
                where: { phone: { in: phonesSeen }, closedReason: { in: ["STAFF", "CUSTOMER"] }, closedAt: { gte: from } },
                _max: { closedAt: true },
            }),
        ]);
        const closedAt = new Map(closes.map((g) => [g.phone, g._max.closedAt?.getTime() ?? 0]));

        const byPhone = new Map<string, Chat>();
        const chatOf = (phone: string, id: number, at: Date) => {
            let c = byPhone.get(phone);
            if (!c) {
                c = { phone, lastId: id, lastInId: null, recent: [], senderName: null, lastAt: at, lastInAt: null, firstAt: null, count: 0, note: null };
                byPhone.set(phone, c);
            } else if (id > c.lastId) { c.lastId = id; c.lastAt = at; }
            return c;
        };
        for (const r of inRows) { // newest first
            const phone = r.phone!;
            if ((closedAt.get(phone) ?? 0) >= r.occurredAt.getTime()) continue; // closed after it — off the popup
            const answered = (contact.get(phone) ?? 0) >= r.occurredAt.getTime();
            const fresh = now - r.occurredAt.getTime() < MESSAGE_REPLY_WINDOW_MS;
            if (answered && !byPhone.has(phone) && !fresh) continue; // answered long ago — nothing to show
            const c = chatOf(phone, r.id, r.occurredAt);
            if (c.lastInId == null) { c.lastInId = r.id; c.lastInAt = r.occurredAt; }
            if (!answered) { c.count++; c.firstAt = r.occurredAt; }
            if (c.recent.length < RECENT && (!answered || c.count === 0)) c.recent.unshift({
                body: r.body,
                mediaUrl: mediaLink(r.mediaKey),
                downloadUrl: r.mediaKey ? mediaLink(r.mediaKey, r.fileName, true) : null,
                mediaType: r.mediaType, fileName: r.fileName, mediaSize: r.mediaSize,
            });
            c.senderName ??= r.senderName;
        }
        const noteBy = new Map<string, number>();
        for (const r of notes) {
            const phone = r.phone!;
            const c = chatOf(phone, r.id, r.occurredAt);
            // Only the newest note matters — it is who the chat was passed to.
            if (c.note) continue;
            c.note = { by: "", text: r.body, at: r.occurredAt.toISOString() };
            if (r.sentByUserId != null) noteBy.set(phone, r.sentByUserId);
        }

        const phones = [...byPhone.keys()];
        const authorIds = Array.from(new Set(noteBy.values()));
        const [claims, authors] = await Promise.all([
            claimsByPhone(phones),
            authorIds.length ? prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } }) : [],
        ]);
        const authorName = new Map(authors.map((u) => [u.id, u.name]));

        const items = [...byPhone.values()].map((c) => ({
            phone: c.phone,
            name: owners.get(c.phone)?.name ?? c.senderName ?? `+91 ${c.phone}`,
            lastId: c.lastId,
            lastInId: c.lastInId,
            body: c.recent[c.recent.length - 1]?.body ?? "",
            recent: c.recent,
            count: c.count,
            lastAt: c.lastAt.toISOString(),
            lastInAt: c.lastInAt?.toISOString() ?? null,
            firstAt: c.firstAt?.toISOString() ?? null,
            waiting: c.count > 0,
            note: c.note ? { ...c.note, by: authorName.get(noteBy.get(c.phone) ?? 0) ?? "Staff" } : null,
            claim: claims.get(c.phone) ?? null,
        }));
        return NextResponse.json({ items });
    } catch (e) {
        return handleApiError(e, "Failed to load message alerts");
    }
}
