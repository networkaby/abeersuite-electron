import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { phoneMatchKey } from "@/shared/lib/format";
import { isMissedCall } from "@/shared/lib/calls";
import { ASSIGNED_POSITION_SELECT } from "@/shared/lib/api/ticketSelects";
import { claimsByPhone, mediaLink, openTicketForPhone, ownersByPhone, replyWindowOpen } from "@/modules/message/lib/customerMessages";

// /api/messages/thread?phone=<10 digits>
//
// GET   — one customer's conversation: their messages and calls by time, the
//         customer the number belongs to, the open ticket, and whether a free
//         reply is still allowed. Read-only (the screen polls it).
// PATCH — { phone, seen: true } marks their messages read;
//         { phone, spam: boolean } flags / clears the number, as on the Call Log.

const THREAD_LIMIT = 200;

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const phone = phoneMatchKey(new URL(req.url).searchParams.get("phone"));
        if (!phone) return NextResponse.json({ error: "phone is required" }, { status: 400 });

        const messages = await prisma.message.findMany({
            where: { phone },
            orderBy: { occurredAt: "desc" },
            take: THREAD_LIMIT,
        });
        const oldest = messages[messages.length - 1]?.occurredAt;
        const [owners, calls, window, claims] = await Promise.all([
            ownersByPhone([phone]),
            prisma.call.findMany({
                where: { phone, spam: false, ...(oldest && messages.length === THREAD_LIMIT ? { occurredAt: { gte: oldest } } : {}) },
                orderBy: { occurredAt: "desc" },
                take: THREAD_LIMIT,
                select: { id: true, direction: true, occurredAt: true, durationSec: true, speechSec: true, note: true },
            }),
            replyWindowOpen(phone),
            claimsByPhone([phone]),
        ]);
        const customer = owners.get(phone) ?? null;

        const ticketId = await openTicketForPhone(phone, customer);
        const ticket = ticketId
            ? await prisma.ticket.findUnique({
                where: { id: ticketId },
                select: {
                    id: true, title: true, priority: true,
                    ticketStatus: { select: { label: true, color: true } },
                    assignedPosition: ASSIGNED_POSITION_SELECT,
                },
            })
            : null;

        // Staff names for OUT replies — one query.
        const userIds = Array.from(new Set(messages.map((m) => m.sentByUserId).filter((v): v is number => v != null)));
        const users = userIds.length
            ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
            : [];
        const userName = new Map(users.map((u) => [u.id, u.name]));

        const items = [
            ...messages.map((m) => ({
                type: "message" as const,
                id: m.id,
                at: m.occurredAt.toISOString(),
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
                ticketId: m.ticketId,
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
                direction: c.direction,
                missed: isMissedCall(c.direction, c.speechSec, c.durationSec),
                durationSec: c.speechSec || c.durationSec,
                note: c.note,
            })),
        ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

        return NextResponse.json({
            phone,
            customer,
            senderName: messages.find((m) => m.senderName)?.senderName ?? null,
            spam: messages.some((m) => m.spam),
            ticket: ticket
                ? {
                    id: ticket.id,
                    title: ticket.title,
                    priority: ticket.priority,
                    status: ticket.ticketStatus?.label ?? null,
                    assignee: ticket.assignedPosition?.holders.map((h) => h.user.name).join(", ") || ticket.assignedPosition?.title || null,
                }
                : null,
            claim: claims.get(phone) ?? null,
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
            await prisma.message.updateMany({ where: { phone, direction: "IN", seenAt: null }, data: { seenAt: new Date() } });
        }
        if (data.spam !== undefined) {
            await prisma.message.updateMany({ where: { phone }, data: { spam: data.spam } });
        }
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to update the conversation");
    }
}
