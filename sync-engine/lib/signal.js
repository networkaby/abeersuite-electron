"use strict";

/**
 * Listens on the app's own change channel so a sync fires when something actually
 * changes, instead of only on the timer.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * Polling every table on a schedule is the slow way to notice a change. The app
 * ALREADY broadcasts a signal on every successful write, and the counter and the
 * office share one Supabase Realtime channel -- so when office staff post a purchase
 * on Vercel, this worker hears about it for free and syncs within a second instead of
 * waiting out the interval.
 *
 * ── The signal is a HINT, never the source of truth ──────────────────────────
 * It is published by an axios response interceptor running IN A BROWSER
 * (src/shared/lib/realtime/appChannel.ts). A write made by a script, a seed, a
 * GitHub-Actions restore, or a browser whose publish failed emits nothing at all.
 * Treating it as authoritative would mean silently missing those changes forever.
 *
 * So: the signal only ever makes a sync happen SOONER. Correctness comes from the
 * watermarks and the reconcile pass, which run on their own schedule regardless of
 * whether a single signal is ever received.
 *
 * Payload is `{ topics, at }` and nothing else -- never a row -- so a forged or
 * duplicated message costs a wasted cycle and can leak nothing.
 *
 * ── Why the topics themselves are ignored ────────────────────────────────────
 * This module used to expand the payload's topics into a model list through a
 * hand-written TOPIC_MODELS map and hand it to the caller, so a cycle could sync
 * only what moved. index.js never used it: `signal.listen(cfg, () => runCycle(...))`
 * discarded the argument and sync-once.js was spawned with no filter, so every
 * signal synced everything anyway. The map had also drifted badly -- 60 of the 113
 * registered tables appeared in no topic -- and because an incomplete list fails
 * quietly (unlike an unknown topic, which fell back to "sync everything"), nobody
 * noticed.
 *
 * It was removed on 2026-09-01 rather than wired up, because the saving it chased
 * does not exist: a cycle where little moved is already close to free. A watermark
 * table returns 0 rows from one indexed query, a child table whose parent did not
 * move does no query at all, and a `full` table is skipped after two aggregate
 * numbers by the fingerprint guard in sync-once.js. Filtering would have shaved a
 * fraction off that while adding a way for the child pass -- which depends on
 * parents actually having been pulled this cycle -- to go quietly wrong.
 *
 * If per-topic syncing is ever wanted for real, the honest version publishes the
 * written tables from the SERVER, where Prisma knows what it wrote, instead of
 * guessing them from a URL in the browser.
 */

const { createClient } = require("@supabase/supabase-js");

/** Must match src/shared/lib/realtime/channel.ts in the app. */
const CHANNEL = "app:changes";
const EVENT = "changed";

/**
 * Wait this long after a signal before syncing.
 *
 * One user action is several requests (save, then re-read, then a badge refresh),
 * each announcing itself. Without a settle window the worker would run a cycle per
 * request rather than per change.
 */
const SETTLE_MS = 750;

/**
 * Subscribe and call `onChange(deleted)` once per settled burst of signals.
 *
 * `deleted` is the union of every `payload.deleted` seen in the burst: Prisma model
 * names the office server reports after a hard delete (src/shared/lib/realtime/
 * deleteAnnounce.ts). A watermark pull can never see a delete, so the cycle this wakes
 * reconciles those tables at once instead of on the hourly schedule. Names only, never
 * keys — an unknown name is ignored by sync-once.js, so a forged payload costs nothing.
 *
 * Returns a stop function. Never throws: Realtime being unavailable must degrade to
 * "sync on the timer only", not take the worker down -- the timer is what makes the
 * signal optional in the first place.
 */
function listen(cfg, onChange, log) {
    const url = cfg.supabaseUrl;
    const key = cfg.supabaseAnonKey;
    if (!url || !key) {
        log("realtime: not configured (supabaseUrl / supabaseAnonKey absent) - timer only");
        return () => {};
    }

    let timer = null;
    let client;
    /** Models named as deleted since the last flush. */
    let deleted = new Set();

    try {
        client = createClient(url, key, { auth: { persistSession: false } });
    } catch (e) {
        log(`realtime: could not create client (${e.message}) - timer only`);
        return () => {};
    }

    const flush = () => {
        timer = null;
        const models = [...deleted];
        deleted = new Set();
        try {
            onChange(models);
        } catch (e) {
            log(`realtime: sync from signal failed: ${e.message}`);
        }
    };

    const channel = client.channel(CHANNEL);
    channel.on("broadcast", { event: EVENT }, ({ payload }) => {
        const named = payload && Array.isArray(payload.deleted) ? payload.deleted : [];
        for (const m of named) if (typeof m === "string" && m) deleted.add(m);
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, SETTLE_MS);
    });

    // Every SUBSCRIBED after the first is a RECONNECT: the socket was down for a while
    // and every signal sent in that gap is gone. A counter coming back online at 13:00
    // after a morning offline must not wait out the interval to learn what changed —
    // a released binding above all — so a reconnect counts as one settled signal.
    let subscribedBefore = false;

    channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
            log(`realtime: listening on ${CHANNEL}${subscribedBefore ? " (reconnected - catching up)" : ""}`);
            if (subscribedBefore) {
                if (timer) clearTimeout(timer);
                timer = setTimeout(flush, SETTLE_MS);
            }
            subscribedBefore = true;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            // supabase-js retries on its own; say so once rather than every attempt.
            log(`realtime: ${status} - will keep retrying, timer still covers us`);
        }
    });

    return () => {
        if (timer) clearTimeout(timer);
        try { client.removeChannel(channel); } catch { /* shutting down anyway */ }
    };
}

module.exports = { listen, CHANNEL, EVENT, SETTLE_MS };
