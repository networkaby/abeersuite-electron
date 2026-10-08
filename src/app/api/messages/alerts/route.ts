import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { claimsByPhone, ownersByPhone } from "@/modules/message/lib/customerMessages";

// GET /api/messages/alerts — what the new-message popup shows: every chat with
// unread customer messages from the last day, one row per number, plus who is
// handling it. The popup decides per staff member who sees which row (owner and
// helpers at once, everyone after MESSAGE_CLAIM_FALLBACK_MS), so one answer
// serves the whole shop and the 10-minute hand-back needs no re-read.
//
// Read on a realtime "messages" signal, never on a timer. Opening the chat on
// the Messages screen marks it seen, which drops it from here for everyone.

const WINDOW_MS = 24 * 60 * 60 * 1000;
const SCAN = 200;
/** Unread messages a popup card shows, newest last. */
const RECENT = 3;

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const rows = await prisma.message.findMany({
            where: { direction: "IN", seenAt: null, spam: false, phone: { not: null }, occurredAt: { gte: new Date(Date.now() - WINDOW_MS) } },
            orderBy: { occurredAt: "desc" },
            take: SCAN,
            select: { id: true, phone: true, body: true, senderName: true, occurredAt: true },
        });

        type Chat = { phone: string; lastId: number; body: string; recent: string[]; senderName: string | null; lastAt: Date; firstAt: Date; count: number };
        const byPhone = new Map<string, Chat>();
        for (const r of rows) {
            const phone = r.phone!;
            const c = byPhone.get(phone);
            if (!c) byPhone.set(phone, { phone, lastId: r.id, body: r.body, recent: [r.body], senderName: r.senderName, lastAt: r.occurredAt, firstAt: r.occurredAt, count: 1 });
            else { c.count++; c.firstAt = r.occurredAt; if (c.recent.length < RECENT) c.recent.unshift(r.body); c.senderName ??= r.senderName; }
        }
        const phones = [...byPhone.keys()];
        const [owners, claims] = await Promise.all([ownersByPhone(phones), claimsByPhone(phones)]);

        const items = [...byPhone.values()].map((c) => ({
            phone: c.phone,
            name: owners.get(c.phone)?.name ?? c.senderName ?? `+91 ${c.phone}`,
            lastId: c.lastId,
            body: c.body,
            recent: c.recent,
            count: c.count,
            lastAt: c.lastAt.toISOString(),
            /** The oldest unread one — what the 10-minute hand-back is measured from. */
            firstAt: c.firstAt.toISOString(),
            claim: claims.get(c.phone) ?? null,
        }));
        return NextResponse.json({ items });
    } catch (e) {
        return handleApiError(e, "Failed to load message alerts");
    }
}
