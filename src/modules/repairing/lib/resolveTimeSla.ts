import type { Prisma } from "@/generated/prisma/client";

/**
 * Status resolve-time SLA — the one place the "is it overdue?" rule lives.
 *
 * A ticket is overdue when it has sat in its current status longer than that
 * status' `resolveTimeHours`. Two surfaces read this: the Work Inbox board and
 * the sidebar badge, and they must agree row-for-row.
 */

const HOUR_MS = 3_600_000;

/** Age is measured from the status change; rows predating the field fall back to updatedAt. */
export function slaEnteredAt(t: { statusEnteredAt: Date | null; updatedAt: Date }): Date {
    return t.statusEnteredAt ?? t.updatedAt;
}

/** How far past the SLA, in ms. `> 0` = overdue; `-1` when the status carries no SLA. */
export function slaOverdueMs(
    t: { statusEnteredAt: Date | null; updatedAt: Date },
    slaHours: number | null | undefined,
    now: number,
): number {
    if (slaHours == null) return -1;
    return now - slaEnteredAt(t).getTime() - slaHours * HOUR_MS;
}

/**
 * Candidates for the work-less overdue path: an active ticket whose status has an
 * SLA but whose sub-status carries NO Work, so it never enters the Work Inbox's
 * normal work-bearing query. Whether each row is actually overdue is decided in
 * JS by `slaOverdueMs` — Prisma cannot compare `now - statusEnteredAt` against a
 * column in SQL. Snoozed rows are excluded, as everywhere else.
 */
export function workLessSlaCandidates(now: Date): Prisma.TicketWhereInput {
    return {
        AND: [
            { ticketStatus: { isTerminal: false, resolveTimeHours: { not: null } } },
            { OR: [{ workerId: null }, { ticketWorker: { workId: null } }] },
            { OR: [{ wakeAt: null }, { wakeAt: { lte: now } }] },
        ],
    };
}

/**
 * Work-less candidates the Work Inbox shows: the overdue path above, plus any
 * active ticket assigned to one of `myPositionIds` — those show to their seat
 * from the moment they are assigned, overdue or not.
 */
export function workLessInboxCandidates(now: Date, myPositionIds: string[]): Prisma.TicketWhereInput {
    if (myPositionIds.length === 0) return workLessSlaCandidates(now);
    return {
        OR: [
            workLessSlaCandidates(now),
            {
                AND: [
                    { ticketStatus: { isTerminal: false } },
                    { assignedPositionId: { in: myPositionIds } },
                    { OR: [{ workerId: null }, { ticketWorker: { workId: null } }] },
                    { OR: [{ wakeAt: null }, { wakeAt: { lte: now } }] },
                ],
            },
        ],
    };
}

/** Which work-less rows a user sees: theirs (assigned to their seat) always; others only when overdue. */
export function showWorkLessRow(
    t: { assignedPositionId: string | null },
    overdueByMs: number,
    mine: Set<string>,
    passesOverdueGate: boolean,
): boolean {
    if (t.assignedPositionId && mine.has(t.assignedPositionId)) return true;
    return overdueByMs > 0 && passesOverdueGate;
}
