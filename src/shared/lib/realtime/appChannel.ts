"use client";

/**
 * The app's single change channel.
 *
 * One Supabase Realtime channel, held by at most ONE tab per computer, no
 * matter how many tabs or screens are listening. That is the cost story:
 * Realtime bills connections and messages, and a heartbeat is a property of
 * the CONNECTION, not of any one channel on it — three open tabs is three
 * heartbeats regardless of how many topics each is subscribed to. So only the
 * tab elected leader (`tabLeader.ts`) ever opens the socket; every other tab
 * reads the exact same signals for free over a `localStorage` mirror. The
 * payload is `{ topics, at }` — never a row.
 *
 * WHO PUBLISHES. Nobody calls `publishChange` by hand. `attachChangePublisher`
 * hangs off an axios instance's response interceptor, so any successful
 * non-GET request to one of our own `/api/...` routes announces itself. New write
 * routes therefore start signalling as soon as their prefix is listed in
 * `topics.ts` — there is no per-call-site step to forget.
 *
 * WHAT IT IS NOT. This is a nudge, not a delivery. A listener's job is to go and
 * re-read its own endpoint; the signal never carries data, so a forged or
 * duplicated one costs a wasted refetch and can leak nothing. That matters
 * because the browser publishes with the anon key, exactly as chat already does.
 *
 * ONE CONNECTION PER COMPUTER, NOT PER TAB. `document.hidden` was tried first
 * and dropped: chat's room subscriptions (`GlobalInboxListener`) are
 * deliberately always-on, in every tab, so a message still notifies you on a
 * backgrounded tab — which means every tab already held its own live socket
 * regardless of visibility, and gating just this channel on hidden/visible
 * saved nothing. `onBecomeLeader` is the real fix: only the leader tab ever
 * calls `connect()` to LISTEN. A non-leader tab still needs to PUBLISH its own
 * writes, so `flush` connects on demand regardless of leadership, sends, and
 * drops the socket again afterward if this tab isn't the one meant to keep it
 * open.
 *
 * The leader mirrors every signal it receives into `localStorage`
 * (`writeCache`/`subscribeToCache`, the same primitive `useNavCounts` already
 * uses for its cross-tab hand-off). The browser fires the `storage` event in
 * every OTHER same-origin tab the instant that write happens — no socket
 * required — so a follower tab learns "ledger changed at 17:42" for free.
 *
 * SWAPPING THE TRANSPORT. If Realtime usage ever outgrows its plan, only this
 * file changes: point `publishChange` at our VM and have `connect` talk to the
 * VM's socket instead. The payload, the topic vocabulary and every listener
 * stay as they are.
 *
 * PROVING THE CONNECTION IS ACTUALLY ALIVE. A quiet channel is ambiguous —
 * "nothing arrived in 20 minutes" could mean nothing changed, or it could mean
 * the leader tab's WebSocket silently died, or the whole browser was minimized
 * and its timers throttled to a crawl. The leader stamps `LIVE_KEY` in
 * `localStorage` on its own clock (`LIVE_STAMP_MS`, independent of Supabase
 * traffic) as well as on every real signal it receives — a JS timer that has
 * stopped ticking IS the browser having gone away, which is a fact a stamp's
 * absence records directly rather than something inferred from message
 * sparsity. Any tab, leader or not, can read `msSinceLastLive()` to ask "was
 * anyone actually here recently" — `useRealtimeTopics` uses it to decide
 * whether a quiet spell can be trusted or needs a real re-read once the tab is
 * looked at again.
 */

import type { AxiosInstance } from "axios";
import { supabase } from "@/shared/lib/supabase/supabaseClient";
import { topicsForApiPath, type Topic } from "./topics";
import { writeCache, readCache, subscribeToCache } from "@/shared/lib/browser/pollCache";
import { isTabLeader, onBecomeLeader } from "./tabLeader";
import { CHANGE_CHANNEL_NAME as CHANNEL_NAME, CHANGE_EVENT_NAME as EVENT_NAME } from "./channel";

/** What travels on the wire: which buckets moved, and when. Nothing else. */
export type ChangeSignal = { topics: Topic[]; at: string };

/** A single save can fire several requests (post, then allocate, then print).
 *  Collect them into one announcement instead of one per request. */
const PUBLISH_COALESCE_MS = 300;

/** How long to wait for the join before sending anyway. Generous — this only
 *  bites on the very first publish since the socket was last (re)connected. */
const JOIN_TIMEOUT_MS = 5_000;

/** Cross-tab mirror of the latest signal — see the module doc's "one connection
 *  per computer" section. Org-wide, not per-user, so a plain key is fine. */
const MIRROR_KEY = "app-changes:v1";

/** Leader's proof-of-life stamp — see the module doc's "proving the connection
 *  is actually alive" section. */
const LIVE_KEY = "app-changes-live:v1";
/** How often the leader stamps on its own clock, Supabase traffic or not. */
const LIVE_STAMP_MS = 60_000;
/** A gap wider than this many stamp intervals means the tab that should have
 *  been ticking wasn't — treat it as a possible miss, not a quiet spell. */
const LIVE_GAP_TOLERANCE = 2.5;

type Listener = (sig: ChangeSignal) => void;

const listeners = new Set<Listener>();
let channel: ReturnType<typeof supabase.channel> | null = null;
let joining: Promise<ReturnType<typeof supabase.channel>> | null = null;
let wantsLive = false;
let liveTimer: ReturnType<typeof setInterval> | null = null;

function stampLive() {
    writeCache(LIVE_KEY, {}, new Date().toISOString());
}

/** Milliseconds since the last proof-of-life stamp, or `null` if there has
 *  never been one (a fresh profile, or Realtime has never run here). */
export function msSinceLastLive(): number | null {
    const at = readCache<Record<string, never>>(LIVE_KEY)?.computedAt;
    return at ? Date.now() - new Date(at).getTime() : null;
}

function notify(sig: ChangeSignal) {
    if (!sig || !Array.isArray(sig.topics) || sig.topics.length === 0) return;
    // Copy first: a listener may unsubscribe itself while we iterate.
    for (const fn of [...listeners]) {
        try { fn(sig); } catch { /* one bad listener must not stop the rest */ }
    }
}

// A sibling tab's live signal, learned for free — no socket needed to hear it,
// and it works whether or not this tab ever becomes leader. Set up once,
// independent of connect/disconnect below.
if (typeof window !== "undefined") {
    subscribeToCache<ChangeSignal>(MIRROR_KEY, (entry) => notify(entry.data));
}

/**
 * Connect the socket. The ONLY thing here that costs a Supabase heartbeat, so
 * every caller is deliberate: the leader tab keeping a listener live, or a
 * publish that must go out right now regardless of leadership.
 */
function connect(): Promise<ReturnType<typeof supabase.channel>> {
    if (joining) return joining;
    joining = new Promise((resolve) => {
        const ch = supabase
            .channel(CHANNEL_NAME)
            .on("broadcast", { event: EVENT_NAME }, ({ payload }) => {
                const sig = payload as ChangeSignal | undefined;
                if (!sig) return;
                notify(sig);
                stampLive();
                // Hand it to every other tab on this machine for free — see MIRROR_KEY.
                writeCache(MIRROR_KEY, sig, sig.at);
            })
            .subscribe((status) => { if (status === "SUBSCRIBED") { stampLive(); resolve(ch); } });

        // Never leave a publish waiting forever on a join that is not coming;
        // a send on an unjoined channel simply fails, which is what we want.
        setTimeout(() => resolve(ch), JOIN_TIMEOUT_MS);
    });
    void joining.then((ch) => { channel = ch; });
    return joining;
}

/**
 * The leader's own clock, independent of whatever Supabase does or doesn't
 * send. Ticking on schedule IS the tab being alive; a late tick reveals the
 * gap directly (the OS throttled/suspended this tab's timers) rather than
 * leaving it to be inferred from how long it has been since the last business
 * signal, which a merely QUIET connection would look identical to.
 */
function startLiveTicker() {
    if (liveTimer) return;
    let lastTick = Date.now();
    liveTimer = setInterval(() => {
        const late = Date.now() - lastTick > LIVE_STAMP_MS * LIVE_GAP_TOLERANCE;
        lastTick = Date.now();
        stampLive();
        // This tab's own timer just proved it was paused for a while — the
        // channel object may be holding a connection that died under it, so
        // don't trust it silently; force a fresh join.
        if (late) { disconnect(); void connect(); }
    }, LIVE_STAMP_MS);
}

/** Drop the socket. Safe to call whether connected, still joining, or already
 *  idle — a non-leader tab with nothing left to send has nothing to keep it
 *  open for. */
function disconnect() {
    const ch = channel;
    const wasJoining = joining;
    channel = null;
    joining = null;
    if (ch) {
        void supabase.removeChannel(ch);
    } else if (wasJoining) {
        // A join was in flight when we decided to drop it; once it lands,
        // close THAT channel too instead of leaving an orphaned live socket.
        void wasJoining.then((c) => { void supabase.removeChannel(c); });
    }
}

// ── Publishing ───────────────────────────────────────────────────────────────

let pending: Set<Topic> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush() {
    flushTimer = null;
    const topics = pending ? [...pending] : [];
    pending = null;
    if (topics.length === 0) return;
    void (async () => {
        try {
            const ch = await connect(); // any tab may publish, leader or not
            await ch.send({
                type:    "broadcast",
                event:   EVENT_NAME,
                payload: { topics, at: new Date().toISOString() } satisfies ChangeSignal,
            });
        } catch { /* a missed nudge is not an error — every surface still has Refresh */
        } finally {
            // Only the leader keeps the socket open on purpose; anyone else
            // was just borrowing it to send, so let it go again.
            if (!wantsLive) disconnect();
        }
    })();
}

/** Announce that these topics changed. Coalesced; safe to call as often as you like.
 *  Supabase broadcast does not echo to the sender, so the acting tab is untouched —
 *  it already knows, and updates through its own save path. */
export function publishChange(topics: readonly Topic[]) {
    if (typeof window === "undefined" || topics.length === 0) return;
    pending ??= new Set<Topic>();
    for (const t of topics) pending.add(t);
    if (flushTimer) return;
    flushTimer = setTimeout(flush, PUBLISH_COALESCE_MS);
}

/**
 * Make every successful write on `instance` announce itself.
 *
 * Returns an eject function for the interceptor. Registered on both axios
 * surfaces we use — the shared `http` instance and the bare global one — because
 * `axios.create()` does not inherit the global interceptors, and most POS/office
 * components still call bare `axios`.
 */
export function attachChangePublisher(instance: AxiosInstance): number {
    return instance.interceptors.response.use((res) => {
        try {
            const method = (res.config.method ?? "get").toLowerCase();
            if (method === "get" || method === "head" || method === "options") return res;

            const url = new URL(
                res.config.url ?? "",
                res.config.baseURL ?? window.location.origin,
            );
            // Never announce a third party's endpoint — and never leak our topic
            // vocabulary to one either.
            if (url.origin !== window.location.origin) return res;

            publishChange(topicsForApiPath(url.pathname));
        } catch { /* publishing must never break the response it rode in on */ }
        return res;
    });
}

// ── Subscribing ──────────────────────────────────────────────────────────────

/**
 * Register `fn` for every signal — live over the socket if this tab wins
 * leadership, or mirrored via `localStorage` the whole time otherwise (which
 * is most tabs, most of the time). Returns an unsubscribe. Prefer the
 * `useRealtimeTopics` hook — this is the primitive underneath it.
 */
export function onChangeSignal(fn: Listener): () => void {
    listeners.add(fn);
    onBecomeLeader(() => {
        wantsLive = true;
        void connect();
        startLiveTicker();
    });
    return () => {
        listeners.delete(fn);
    };
}

/** True if THIS tab is the one holding the live Realtime connection. Exported
 *  for other always-on subscribers (chat) that need the same leader gate. */
export { isTabLeader };
