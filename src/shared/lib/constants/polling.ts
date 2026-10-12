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
 * Three days covers a late call logged the next morning, or a day off, without
 * letting a week of forgotten calls pile up behind the icon.
 */
export const CALL_POPUP_MAX_AGE_MS = 72 * 60 * 60 * 1000;   // 3 days

/**
 * How long the follow-up popup trusts its own "I just saved this" memory while
 * the server still says the call is unhandled.
 *
 * A save is two writes (the ticket or deal, then the PATCH that marks the call
 * handled), and on a counter the PATCH is relayed to the office and has to come
 * back down through the replica — so a refresh in between honestly reads the
 * call as still unlogged. Hiding it for this long keeps it off the screen while
 * that settles.
 *
 * **It is a delay, never a permanent hide.** Past this window the call comes
 * back WITH a line saying it was logged and has not arrived yet, so a save that
 * genuinely failed — or a replica that is not receiving — surfaces instead of
 * disappearing. Edit this one line to give the sync more or less benefit of the
 * doubt.
 */
export const CALL_POPUP_HANDLED_TTL_MS = 15 * 60 * 1000;   // 15 minutes

/**
 * The follow-up icon sits quietly with its count until the last call is
 * logged; the panel opens by itself on a NEWLY arrived call, and otherwise on
 * this cadence — a scheduled "these are still waiting" nudge rather than a
 * five-minute nag. **Edit this one line to change how often it asks.**
 */
export const CALL_POPUP_REMIND_MS = 30 * 60 * 1000;   // 30 minutes

/**
 * How long a call waits at its own counter before every counter's follow-up
 * popup shows it too. A counter sees the calls on its own extension(s) at once;
 * once a call has gone this long without being logged, it is nobody's in
 * particular any more and any counter may take it.
 *
 * A call that belongs to no counter never waits: one with no extension (an
 * unanswered incoming call records none) or on an extension no counter is set
 * to (a spare handset, say Ext 45) shows everywhere at once.
 * **Edit this one line to change how long a counter has its calls to itself.**
 */
export const CALL_POPUP_PUBLIC_AFTER_MS = 30 * 60 * 1000;   // 30 minutes

/**
 * How long a customer message waits unread with its chat's owner before the
 * new-message popup shows it to every staff member again. Until then a claimed
 * chat pops up only for its owner and invited helpers (MessageClaim).
 * **Edit this one line to change how long an owner has a chat to themself.**
 */
export const MESSAGE_CLAIM_FALLBACK_MS = 10 * 60 * 1000;   // 10 minutes

/**
 * WhatsApp's customer-service window: a free-text reply is allowed only this
 * long after the customer's last message. Past it the popup's reply box locks
 * and asks staff to call; the card still waits until the customer is reached.
 * Fixed by Meta — not a shop setting.
 */
export const MESSAGE_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;   // 24 hours

/**
 * Customer messages from before this moment never raise a "waiting" card —
 * the follow-up rule (a message stays until the shop gets back to them) began
 * here, and the chats already sitting unanswered were not to flood the popup.
 */
export const MESSAGE_FOLLOWUP_START = new Date("2026-10-12T12:00:00+05:30");

/**
 * The shell's two status surfaces — /api/counter/status and /api/sync/status,
 * feeding the counter badge, the sync badge and the Electron window title.
 *
 * ── Why 10s on a counter ────────────────────────────────────────────────────
 * This was 30s, justified on the grounds that "a cashier learns the shop is offline
 * from the failed Save either way". That justification no longer holds, twice over:
 * offline writes now mean some saves SUCCEED while offline, so a failed save is no
 * longer the reliable teacher it was; and the badge is now a permanent green/red
 * light rather than a warning that only appears when something is wrong. A permanent
 * light that can be half a minute stale is worse than no light, because people
 * believe it.
 *
 * 10s is still not a heartbeat. Both endpoints answer from process memory plus, at
 * most, one small query against the LOCAL database — neither touches Supabase, so a
 * faster tick costs no egress, which is the thing this whole project exists to
 * protect. And it is now ONE tick per endpoint for the whole app rather than one per
 * mounted badge; see the shared store in `useCounterMode.ts`.
 */
export const COUNTER_STATUS_POLL_MS = 10_000;   // 10 seconds

/**
 * The same two surfaces once the answer has SETTLED — off a counter, or before
 * anyone has signed in.
 *
 * `IS_COUNTER_PC` is a `const` read once from env (`prisma/counterMode.ts`), so on an
 * office PC, on Vercel and on the public storefront `isCounter: false` is the answer
 * for the life of the server process. Re-asking it every 10s bought nothing and still
 * cost a `requireAuth()` session lookup per ask, on every page of the app including
 * the shop, where the caller is not even logged in.
 *
 * A distant fallback rather than a full stop, same reasoning as `NAV_COUNTS_POLL_MS`:
 * the shared store also re-reads on becoming visible, and `refreshCounterStatus()` /
 * `refreshSyncStatus()` force a read the moment someone signs in. A day is cheap
 * insurance against all three of those somehow failing to fire.
 */
export const COUNTER_STATUS_IDLE_POLL_MS = 86_400_000;   // 24 hours

/**
 * The staleness floor under every live screen — how long a VISIBLE screen may go
 * without re-reading when no change signal arrives (see `realtime/settledReader.ts`).
 * Five minutes is chosen against the cost rule (AGENTS.md §7): long enough that an
 * idle office screen is nearly free, short enough that a missed signal is a
 * nuisance rather than a wrong decision. A screen that IS hearing signals never
 * pays it — every read pushes the deadline out.
 */
export const SCREEN_HEARTBEAT_MS = 5 * 60 * 1000;   // 5 minutes

// ── Phone app (/m) ──────────────────────────────────────────────────────────
// The phone keeps each screen's last server answer on the device (Dexie
// `answers`). These decide when it asks again — and when it does, it sends the
// answer's `computedAt` back as `?since=`, so a quiet book costs one indexed
// probe instead of a recompute (see `isUnchangedSince`).

/** A saved answer younger than this is shown without asking the server at all.
 *  Pull-to-refresh (the ↻ button) always asks. */
export const MOBILE_FRESH_MS = 60_000;   // 1 minute

/** The Pay / Receive form's cash-bank ledgers and branches — configuration,
 *  rarely edited, so it is asked for far less often. */
export const MOBILE_SETUP_FRESH_MS = 600_000;   // 10 minutes

/** How long the server trusts a phone's `?since=` "nothing posted since" before
 *  recomputing anyway. Bounds what that check cannot see — the day rolling over
 *  (bills age a day with nothing written), or a change that touches no voucher. */
export const MOBILE_SINCE_TRUST_MS = 1_800_000;   // 30 minutes
