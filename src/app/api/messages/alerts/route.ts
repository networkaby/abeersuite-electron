import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { claimsByPhone, ownersByPhone } from "@/modules/message/lib/customerMessages";

// GET /api/messages/alerts — what the new-message popup shows: every chat from
// the last day with unread customer messages OR an unanswered staff @mention
// note, one row per number, plus who is handling it. The popup decides per staff
// member who sees which row (owner and helpers at once, everyone after
// MESSAGE_CLAIM_FALLBACK_MS for customer messages), so one answer serves the
// whole shop and the 10-minute hand-back needs no re-read.
//
// Read on a realtime "messages" signal, never on a timer. A reply, or opening
// the chat on the Messages screen, marks it seen and drops it for everyone.

const WINDOW_MS = 24 * 60 * 60 * 1000;
const SCAN = 200;
/** Unread messages a popup card shows, newest last. */
const RECENT = 3;

type Chat = {
    phone: string;
    lastId: number;
    body: string;
    recent: string[];
    senderName: string | null;
    lastAt: Date;
    /** Oldest unread CUSTOMER message — null when only a note is waiting. */
    firstAt: Date | null;
    count: number;
    note: { by: string; text: string; at: string } | null;
};

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const rows = await prisma.message.findMany({
            where: {
                direction: { in: ["IN", "NOTE"] }, seenAt: null, spam: false, phone: { not: null },
                occurredAt: { gte: new Date(Date.now() - WINDOW_MS) },
            },
            orderBy: { occurredAt: "desc" },
            take: SCAN,
            select: { id: true, phone: true, direction: true, body: true, senderName: true, occurredAt: true, sentByUserId: true },
        });

        const byPhone = new Map<string, Chat>();
        const noteBy = new Map<string, number>();
        for (const r of rows) {
            const phone = r.phone!;
            let c = byPhone.get(phone);
            if (!c) {
                c = { phone, lastId: r.id, body: "", recent: [], senderName: null, lastAt: r.occurredAt, firstAt: null, count: 0, note: null };
                byPhone.set(phone, c);
            }
            if (r.direction === "NOTE") {
                // Only the newest note matters — it is who the chat was passed to.
                if (!c.note) {
                    c.note = { by: "", text: r.body, at: r.occurredAt.toISOString() };
                    if (r.sentByUserId != null) noteBy.set(phone, r.sentByUserId);
                }
                continue;
            }
            if (!c.count) c.body = r.body;
            c.count++;
            c.firstAt = r.occurredAt;
            if (c.recent.length < RECENT) c.recent.unshift(r.body);
            c.senderName ??= r.senderName;
        }

        const phones = [...byPhone.keys()];
        const authorIds = Array.from(new Set(noteBy.values()));
        const [owners, claims, authors] = await Promise.all([
            ownersByPhone(phones),
            claimsByPhone(phones),
            authorIds.length ? prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } }) : [],
        ]);
        const authorName = new Map(authors.map((u) => [u.id, u.name]));

        const items = [...byPhone.values()].map((c) => ({
            phone: c.phone,
            name: owners.get(c.phone)?.name ?? c.senderName ?? `+91 ${c.phone}`,
            lastId: c.lastId,
            body: c.body,
            recent: c.recent,
            count: c.count,
            lastAt: c.lastAt.toISOString(),
            firstAt: c.firstAt?.toISOString() ?? null,
            note: c.note ? { ...c.note, by: authorName.get(noteBy.get(c.phone) ?? 0) ?? "Staff" } : null,
            claim: claims.get(c.phone) ?? null,
        }));
        return NextResponse.json({ items });
    } catch (e) {
        return handleApiError(e, "Failed to load message alerts");
    }
}
