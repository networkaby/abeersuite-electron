/**
 * How often each background refresh re-reads the server. Edit here — nothing sets
 * an interval of its own.
 *
 * These are the whole app's database-egress dial. Every tick is a round of queries
 * per open tab, so doubling a number here roughly halves what that surface costs.
 * Nothing here ticks while its tab is hidden, and every one of these surfaces has a
 * manual refresh control, so a slower number costs patience, never access to the
 * current figure. See `usePolling`.
 */

/** Sidebar badges, chat unread and the notification bell — all one request. */
export const NAV_COUNTS_POLL_MS = 180_000;

/** Cash position / usable fund in the finance top bar. */
export const FINANCE_BAR_POLL_MS = 180_000;

/** Discovery of newly created chat rooms. Existing rooms deliver over the Supabase
 *  broadcast regardless, so this only governs how soon a brand-new DM starts
 *  notifying. */
export const INBOX_ROOMS_POLL_MS = 180_000;

/** Fallback re-read of the open chat thread, in case the broadcast socket dropped. */
export const INBOX_MESSAGES_POLL_MS = 60_000;

/**
 * POS shift bar and the counter status board. Deliberately the fastest of the set:
 * this is live till money someone may be standing in front of.
 */
export const POS_LIVE_POLL_MS = 30_000;
