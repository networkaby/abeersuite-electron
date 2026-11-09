/**
 * How many rows one request returns. Like the polling intervals, these are a
 * database-cost dial: a bigger page means fewer round trips but more rows read
 * per trip.
 */

/** Rows an API list returns when the caller asks for no `limit` (see `api/parsePagination.ts`). */
export const DEFAULT_PAGE_SIZE = 50;

/** The most rows one API list request may ask for, whatever `limit` says. */
export const MAX_PAGE_SIZE = 200;

/** Rows per page on the Contacts and Companies directories. Matches the "grow on
 *  scroll" panel's page size (see `parties/browsePage.ts`). */
export const BROWSE_PAGE_SIZE = 50;

/** Closed tickets (Help, Deals, Tasks) the board downloads and keeps on the
 *  device: only those closed within this many days. Older ones are never
 *  deleted — Help's search still finds them on the server. */
export const CLOSED_TICKET_WINDOW_DAYS = 30;

/** Cards a board column draws before its "Show more" button. */
export const BOARD_COLUMN_PAGE = 20;
