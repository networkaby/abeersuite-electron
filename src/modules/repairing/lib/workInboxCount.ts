import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { ResolvedUser } from "@/shared/lib/auth/permissions";
import { passesWorkGate } from "./workGate";

/**
 * Counts behind the sidebar "Work Flow" badge.
 *
 *  all — everything the Work Inbox lists in its active queues: a non-terminal
 *        ticket sitting in a work-bearing worker, whose Work the caller may act
 *        on, and not snoozed. Same definition as WorkInboxBoard's `openCount`,
 *        so the badge and the page header can never disagree.
 *  new — of those, the ones that ARRIVED since the user last opened the page
 *        (User.workInboxSeenAt). Arrival = Ticket.statusEnteredAt, so a ticket
 *        moving into a new status counts as fresh work at that stage. Rows that
 *        predate statusEnteredAt fall back to updatedAt, exactly as the page's
 *        age label does. A null marker means "never looked" → all are new.
 *
 * Two count() calls — no rows leave the database, because this is polled from
 * every page in the app.
 */
export async function getWorkInboxCounts(user: ResolvedUser) {
    const [works, me] = await Promise.all([
        prisma.work.findMany({ select: { id: true, permissionId: true } }),
        prisma.user.findUnique({
            where: { id: user.id },
            select: { workInboxSeenAt: true },
        }),
    ]);

    const visibleWorkIds = works.filter((w) => passesWorkGate(user, w)).map((w) => w.id);
    if (visibleWorkIds.length === 0) return { all: 0, new: 0 };

    const now = new Date();
    const activeWhere: Prisma.TicketWhereInput = {
        ticketStatus: { isTerminal: false },
        ticketWorker: { workId: { in: visibleWorkIds } },
        // Snoozed items live in the "Waiting" tab, out of the active queues.
        OR: [{ wakeAt: null }, { wakeAt: { lte: now } }],
    };

    const seenAt = me?.workInboxSeenAt ?? null;
    const arrivedSince: Prisma.TicketWhereInput = seenAt
        ? {
            OR: [
                { statusEnteredAt: { gt: seenAt } },
                { statusEnteredAt: null, updatedAt: { gt: seenAt } },
            ],
        }
        : {};

    const [all, fresh] = await Promise.all([
        prisma.ticket.count({ where: activeWhere }),
        prisma.ticket.count({ where: { AND: [activeWhere, arrivedSince] } }),
    ]);

    return { all, new: fresh };
}
