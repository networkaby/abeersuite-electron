import { NextResponse } from "next/server";

/**
 * The delta-sync envelope every board-shaped endpoint speaks (tickets,
 * admin-tasks, deals, help, day-book) and `useTicketsDelta` consumes on the
 * client. One home for the cap and the two response shapes, so the five
 * routes cannot drift on what "delta" or "page" means.
 *
 *   page  → { mode: "page",  rows, nextCursor, computedAt }
 *   delta → { mode: "delta", rows, overflow,   computedAt }
 */

/**
 * Past this a delta has stopped being cheaper than starting over, so we say so
 * (`overflow: true`, no rows) and let the client drop its copy and re-page
 * from the top.
 */
export const MAX_DELTA_ROWS = 500;

/**
 * Run the "what changed since" query with one row more than the cap, so a
 * single query tells us whether the delta overflowed. `T` flows from the
 * route's own select/include — pass the findMany, not its arguments.
 */
export async function deltaSlice<T>(
    findMany: (take: number) => Promise<T[]>,
): Promise<{ changed: T[]; overflow: boolean }> {
    const changed = await findMany(MAX_DELTA_ROWS + 1);
    const overflow = changed.length > MAX_DELTA_ROWS;
    return { changed: overflow ? [] : changed, overflow };
}

/**
 * Split a `take + 1` page query into the page and its cursor: the id of the
 * last row when another page exists, else null.
 */
export function pageSlice<T extends { id: number | string }>(
    rowsPlusOne: T[],
    take: number,
): { rows: T[]; nextCursor: T["id"] | null } {
    const hasMore = rowsPlusOne.length > take;
    const rows = hasMore ? rowsPlusOne.slice(0, take) : rowsPlusOne;
    const nextCursor = hasMore && rows.length > 0 ? rows[rows.length - 1].id : null;
    return { rows, nextCursor };
}

export function deltaResponse<R>(rows: R[], overflow: boolean, computedAt: Date): NextResponse {
    return NextResponse.json({ mode: "delta", rows, overflow, computedAt: computedAt.toISOString() });
}

export function pageResponse<R>(rows: R[], nextCursor: number | string | null, computedAt: Date): NextResponse {
    return NextResponse.json({ mode: "page", rows, nextCursor, computedAt: computedAt.toISOString() });
}
