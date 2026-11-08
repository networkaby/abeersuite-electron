import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { Prisma } from "@/generated/prisma/client";
import { findEntryWorker } from "./entryWorker";
import { messageOnStatusEntry } from "./actions";

/**
 * Status auto-move (owner, 2026-11-08): a ticket left in a status for
 * `TicketStatus.autoMoveAfterDays` days moves to `autoMoveToId` with no one
 * clicking — e.g. Resolved → Closed after 7 days, "no repeat complaint = fixed".
 *
 * Run by /api/cron/communications (every 30 min, 08:00–20:00 IST); safe to
 * repeat. The clock is `Ticket.statusEnteredAt`, so moving a ticket back (a
 * repeat complaint) starts it over. A ticket whose customer has written (an IN
 * Message on the ticket) since it entered the status is skipped and left for
 * staff — that message may be the repeat complaint.
 *
 * The move is a normal one: the target's start worker applies, closedAt is
 * stamped on a terminal target (cleared otherwise), the target's customer
 * message goes out, and a SYSTEM timeline line records it.
 */

const BATCH = 200;

/** Timeline / message actor for moves no person made. */
const SYSTEM_AUTHOR = { userId: 0, userName: "System" } satisfies Prisma.InputJsonValue;

export async function runStatusAutoMoves(now = new Date()): Promise<{ moved: number; skipped: number }> {
    const rules = await prisma.ticketStatus.findMany({
        where: { autoMoveAfterDays: { not: null }, autoMoveToId: { not: null } },
        select: {
            id: true, label: true, autoMoveAfterDays: true, autoMoveToId: true,
            autoMoveTo: { select: { label: true, isTerminal: true } },
        },
    });

    let moved = 0;
    let skipped = 0;
    for (const rule of rules) {
        if (!rule.autoMoveTo || !rule.autoMoveToId || !rule.autoMoveAfterDays) continue;
        const cutoff = new Date(now.getTime() - rule.autoMoveAfterDays * 86_400_000);
        const due = await prisma.ticket.findMany({
            where: { status: rule.id, statusEnteredAt: { lte: cutoff } },
            select: { id: true, statusEnteredAt: true },
            orderBy: { statusEnteredAt: "asc" },
            take: BATCH,
        });
        if (!due.length) continue;

        // Customer wrote since entering the status → leave it for staff.
        const wrote = await prisma.message.findMany({
            where: { ticketId: { in: due.map((t) => t.id) }, direction: "IN" },
            select: { ticketId: true, occurredAt: true },
        });
        const entry = await findEntryWorker(rule.autoMoveToId);
        const note = `Auto-moved to "${rule.autoMoveTo.label}" after ${rule.autoMoveAfterDays} day${rule.autoMoveAfterDays === 1 ? "" : "s"} in "${rule.label}"`;

        for (const t of due) {
            const since = t.statusEnteredAt ?? cutoff;
            if (wrote.some((m) => m.ticketId === t.id && m.occurredAt >= since)) { skipped++; continue; }
            // Guarded update: only if it is still in this status (staff may have moved it).
            const res = await prisma.ticket.updateMany({
                where: { id: t.id, status: rule.id },
                data: {
                    status: rule.autoMoveToId,
                    workerId: entry?.id ?? null,
                    statusEnteredAt: now,
                    closedAt: rule.autoMoveTo.isTerminal ? now : null,
                    wakeAt: null,
                },
            });
            if (res.count === 0) continue;
            await prisma.ticketLog.create({
                data: { ticketId: t.id, kind: "SYSTEM", note, author: SYSTEM_AUTHOR, status: rule.autoMoveToId, workerId: entry?.id ?? null },
            }).catch((e) => console.error(`[auto-move] log for ticket ${t.id} failed`, e));
            await messageOnStatusEntry(t.id, rule.autoMoveToId, 0, SYSTEM_AUTHOR);
            moved++;
        }
    }
    return { moved, skipped };
}
