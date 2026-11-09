import { CLOSED_TICKET_WINDOW_DAYS } from "@/shared/lib/constants/paging";

/** Start of the window: tickets closed before this are left off the board. */
export function closedWindowStart(now: Date = new Date()): Date {
    return new Date(now.getTime() - CLOSED_TICKET_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

/** Prisma `where` piece for a board's first download: every open ticket plus
 *  the recently closed ones. */
export function openOrRecentlyClosedWhere(now: Date = new Date()) {
    return { OR: [{ closedAt: null }, { closedAt: { gte: closedWindowStart(now) } }] };
}

/** Same rule on the device, for rows already held (a delta may carry an old
 *  closed ticket that was touched again; the cache drops it once it ages out). */
export function isOpenOrRecentlyClosed(closedAt: string | Date | null | undefined, now: Date = new Date()): boolean {
    return !closedAt || new Date(closedAt).getTime() >= closedWindowStart(now).getTime();
}
