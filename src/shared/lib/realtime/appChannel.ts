"use client";

/**
 * The app's single change channel.
 *
 * One Supabase Realtime channel for the WHOLE tab, no matter how many screens are
 * listening. That is the cost story: Realtime bills connections and messages, so
 * a hundred live surfaces must not mean a hundred sockets. Every listener shares
 * this one, and the payload is `{ topics, at }` — never a row.
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
 * SWAPPING THE TRANSPORT. If Realtime usage ever outgrows its plan, only this
 * file changes: point `publishChange` at our VM and have `ensureChannel`
 * subscribe to the VM's socket instead. The payload, the topic vocabulary and
 * every listener stay as they are.
 */

import type { AxiosInstance } from "axios";
import { supabase } from "@/shared/lib/supabase/supabaseClient";
import { topicsForApiPath, type Topic } from "./topics";

/** What travels on the wire: which buckets moved, and when. Nothing else. */
export type ChangeSignal = { topics: Topic[]; at: string };

const CHANNEL_NAME = "app:changes";
const EVENT_NAME   = "changed";

/** A single save can fire several requests (post, then allocate, then print).
 *  Collect them into one announcement instead of one per request. */
const PUBLISH_COALESCE_MS = 300;

type Listener = (sig: ChangeSignal) => void;

/** How long to wait for the join before sending anyway. Generous — this only
 *  bites on the very first publish of a tab's life, when nothing has needed the
 *  channel yet. */
const JOIN_TIMEOUT_MS = 5_000;

const listeners = new Set<Listener>();
let ready: Promise<ReturnType<typeof supabase.channel>> | null = null;

/**
 * The channel, resolved once it has actually JOINED.
 *
 * A promise rather than the channel itself because `send()` on a channel that is
 * still joining is dropped on the floor. That is not a theoretical race: the
 * publishing tab is usually the one with NO listener — someone posting a voucher
 * is looking at the voucher form, not at a register — so its very first publish
 * is also what creates the channel, and sending straight away lost the broadcast
 * every time. Every publish now waits for the join.
 *
 * Subscribes lazily and stays up for the life of the tab: the socket is the
 * expensive part, and tearing it down between screens would mean paying for the
 * handshake every time someone navigates.
 */
function ensureChannel(): Promise<ReturnType<typeof supabase.channel>> {
    if (ready) return ready;
    ready = new Promise((resolve) => {
        const ch = supabase
            .channel(CHANNEL_NAME)
            .on("broadcast", { event: EVENT_NAME }, ({ payload }) => {
                const sig = payload as ChangeSignal | undefined;
                if (!sig || !Array.isArray(sig.topics) || sig.topics.length === 0) return;
                // Copy first: a listener may unsubscribe itself while we iterate.
                for (const fn of [...listeners]) {
                    try { fn(sig); } catch { /* one bad listener must not stop the rest */ }
                }
            })
            .subscribe((status) => { if (status === "SUBSCRIBED") resolve(ch); });

        // Never leave a publish waiting forever on a join that is not coming;
        // a send on an unjoined channel simply fails, which is what we want.
        setTimeout(() => resolve(ch), JOIN_TIMEOUT_MS);
    });
    return ready;
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
            const ch = await ensureChannel();
            await ch.send({
                type:    "broadcast",
                event:   EVENT_NAME,
                payload: { topics, at: new Date().toISOString() } satisfies ChangeSignal,
            });
        } catch { /* a missed nudge is not an error — every surface still has Refresh */ }
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

/** Register `fn` for every signal. Returns an unsubscribe. Prefer the
 *  `useRealtimeTopics` hook — this is the primitive underneath it. */
export function onChangeSignal(fn: Listener): () => void {
    void ensureChannel();
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}
