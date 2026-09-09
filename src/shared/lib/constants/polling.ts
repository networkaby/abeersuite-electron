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

/**
 * Sidebar badges, chat unread and the notification bell — all one request.
 *
 * A DISTANT FALLBACK now, not the mechanism: badges recount on a "tickets"
 * change signal (see `useNavCounts.ts`), on window focus, and on returning
 * from a hidden tab, all of which fire far more often than any interval would.
 * Left running rather than removed — a day is cheap insurance against a signal
 * silently failing to arrive, without costing anything close to what a 3-minute
 * tick did. Revisit downward only if a real gap between "something changed" and
 * "the badge noticed" is ever actually observed.
 */
export const NAV_COUNTS_POLL_MS = 86_400_000;   // 24 hours

/**
 * How long the server trusts a client's `?since=` cheap-check before forcing a
 * full recompute regardless — see `hasNavCountsChangedSince`'s "since is only
 * honored within one poll interval" note. This used to just BE
 * `NAV_COUNTS_POLL_MS`, back when that constant was both the tick and the
 * trust window by one and the same design. It can no longer share the number:
 * `NAV_COUNTS_POLL_MS` now means "a day-long insurance policy," not "how
 * fresh a since-check is allowed to be," and reusing it here would let a
 * client's cached total go uncorrected for a full day the moment the delta
 * check has ANY blind spot (there's always the risk of one — the whole reason
 * this trust window exists is to bound how long a blind spot can hide).
 */
export const NAV_COUNTS_SINCE_TRUST_MS = 180_000;   // 3 minutes

/** Cash position / usable fund in the finance top bar. */
export const FINANCE_BAR_POLL_MS = 180_000;

/**
 * Discovery of newly created chat rooms.
 *
 * A DISTANT FALLBACK now: a new DM room announces itself on the "chat" topic
 * (`GlobalInboxListener` picks it up via `useRealtimeTopics` the instant it's
 * created) and existing rooms keep delivering over their own broadcast
 * regardless. Left running, not removed, for the same reason as
 * `NAV_COUNTS_POLL_MS` — a day-long safety net costs nothing.
 */
export const INBOX_ROOMS_POLL_MS = 86_400_000;   // 24 hours

/** Fallback re-read of the open chat thread, in case the broadcast socket dropped. */
export const INBOX_MESSAGES_POLL_MS = 60_000;

/**
 * POS shift bar and the counter status board.
 *
 * Effectively dormant: both surfaces carry a manual refresh control, and the
 * figures only move when someone opens, hands over or closes a shift — an act
 * the person doing it already knows about. An automatic re-read every half
 * minute was billing us for a change that had not happened. Revisit when real
 * counters run side by side and one terminal must notice another's shift
 * without being told.
 */
export const POS_LIVE_POLL_MS = 5_400_000;   // 90 minutes

/**
 * The counter call follow-up popup (CallFollowUpPopup) — checks for a just-
 * finished, not-yet-logged call at this counter's extension.
 *
 * A SAFETY NET now, not the primary mechanism: the row is written by the
 * epbx-bridge posting directly to `/api/calls` from the counter PC's own
 * process, never through this app's browser axios instance — so it can't rely
 * on `attachChangePublisher`'s interceptor the way most writes do. Instead
 * `/api/calls`' POST handler publishes the "tickets" signal itself, server-side
 * (see `serverPublish.ts`), so the popup normally reacts within ~1s over the
 * same realtime channel. This poll just covers the gap if that publish is
 * ever missed (socket hiccup, bridge retry racing the signal, etc).
 */
export const CALL_POPUP_POLL_MS = 20_000;   // 20 seconds

/**
 * How long an unlogged call keeps waiting in the counter's follow-up icon
 * (CallFollowUpPopup) before it drops off.
 *
 * **Edit this one line to widen or narrow that window.** It is a display rule
 * only — the call row itself is never deleted or hidden from the CRM Call Log
 * page; this decides only how long the counter keeps being reminded about it.
 * Two days covers a late call logged the next morning, or a day off, without
 * letting a week of forgotten calls pile up behind the icon.
 */
export const CALL_POPUP_MAX_AGE_MS = 72 * 60 * 60 * 1000;   // 2 days

/**
 * The follow-up icon sits quietly with its count until the last call is
 * logged; the panel opens by itself on a NEWLY arrived call, and otherwise on
 * this cadence — a scheduled "these are still waiting" nudge rather than a
 * five-minute nag. **Edit this one line to change how often it asks.**
 */
export const CALL_POPUP_REMIND_MS = 30 * 60 * 1000;   // 30 minutes
