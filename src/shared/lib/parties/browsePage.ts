/**
 * Shared paging math for the Contacts (`/api/person`) and Companies
 * (`/api/companies`) browse lists — the two admin directories, kept identical
 * on purpose since they are the same feature over two tables.
 *
 * ALPHABETICAL ONLY. Name-order is the one sort this page paginates server
 * side, because it is the one order both the server and the browser's party
 * cache can agree on without disagreement risk — both just alphabetise. Ledger
 * balance is a computed value (`effectiveAccountBalance` folds in an opening
 * balance conditionally), not a plain column a keyset cursor can walk, and the
 * cache never carries it at all (a directory must not paint a guessed number
 * where money is read). So an Amount-sorted view is not paginated here — it
 * stays what it already was, one unbounded fetch, client-sorted — and this
 * module is simply not involved on that path.
 */

/** Rows per page. Matches the "grow on scroll" panel's page size. */
export const BROWSE_PAGE_SIZE = 50;

export type BrowseCursor = { name: string; id: number };

/** Read `cursorName`/`cursorId` off the request, or null for a first page. */
export function parseBrowseCursor(searchParams: URLSearchParams): BrowseCursor | null {
    const name = searchParams.get("cursorName");
    const idParam = searchParams.get("cursorId");
    if (name == null || idParam == null) return null;
    const id = Number(idParam);
    if (!Number.isFinite(id)) return null;
    return { name, id };
}

/** `orderBy` for the paginated branch. `id` breaks ties between same-named rows. */
export const NAME_ORDER = [{ name: "asc" as const }, { id: "asc" as const }];

/** `where` fragment for "strictly after this cursor" in `NAME_ORDER`. Spread into
 *  the existing `AND` array — an empty object on a first page matches everything. */
export function afterCursor(cursor: BrowseCursor | null) {
    if (!cursor) return {};
    return {
        OR: [
            { name: { gt: cursor.name } },
            { name: cursor.name, id: { gt: cursor.id } },
        ],
    };
}

/** The cursor for the NEXT page, or null once a page comes back short — the
 *  ordinary "shorter than asked for means the last one" end-of-list signal. */
export function nextBrowseCursor<T extends { id: number; name: string }>(
    rows: T[],
    limit: number,
): BrowseCursor | null {
    if (rows.length < limit) return null;
    const last = rows[rows.length - 1];
    return { name: last.name, id: last.id };
}
