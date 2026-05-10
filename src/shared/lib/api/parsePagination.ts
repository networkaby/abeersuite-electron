/**
 * Pagination helpers — pulls `limit` / `take` and `page` (or `cursor`) out of `URLSearchParams`,
 * clamps to safe bounds, and returns ready-to-use values for Prisma `take` / `skip`.
 *
 * Default limit is `DEFAULT_PAGE_SIZE` (50). Hard upper bound is `MAX_PAGE_SIZE` (200).
 */

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

type SP = URLSearchParams | { get(key: string): string | null };

function readNum(sp: SP, key: string): number | null {
    const raw = sp.get(key);
    if (raw === null || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}

/** Offset-style pagination: `?limit=50&page=1` → `{ take, skip, page }`. */
export function parsePagination(
    sp: SP,
    opts: { defaultLimit?: number; maxLimit?: number } = {},
): { take: number; skip: number; page: number } {
    const defaultLimit = opts.defaultLimit ?? DEFAULT_PAGE_SIZE;
    const maxLimit = opts.maxLimit ?? MAX_PAGE_SIZE;

    const rawLimit = readNum(sp, "limit") ?? readNum(sp, "take") ?? defaultLimit;
    const take = Math.min(maxLimit, Math.max(1, Math.floor(rawLimit)));

    const rawPage = readNum(sp, "page") ?? 1;
    const page = Math.max(1, Math.floor(rawPage));

    return { take, skip: (page - 1) * take, page };
}

/** Cursor-style pagination: `?cursor=42&limit=50` → `{ cursor, take }`. */
export function parseCursor(
    sp: SP,
    opts: { defaultLimit?: number; maxLimit?: number } = {},
): { cursor: number | undefined; take: number } {
    const defaultLimit = opts.defaultLimit ?? DEFAULT_PAGE_SIZE;
    const maxLimit = opts.maxLimit ?? MAX_PAGE_SIZE;

    const rawLimit = readNum(sp, "limit") ?? readNum(sp, "take") ?? defaultLimit;
    const take = Math.min(maxLimit, Math.max(1, Math.floor(rawLimit)));

    const rawCursor = readNum(sp, "cursor");
    const cursor = rawCursor !== null && rawCursor > 0 ? rawCursor : undefined;

    return { cursor, take };
}
