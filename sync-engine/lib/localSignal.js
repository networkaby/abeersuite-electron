"use strict";

/**
 * The app's own "pull now" line to this worker, over the local replica.
 *
 * ── Why a second signal ──────────────────────────────────────────────────────
 * `signal.js` hears the shop-wide change signal from Supabase Realtime: a hint that
 * something, somewhere, changed. This one is narrower and local. Under
 * `WRITE_MODE=v_live` the app relays a write to the office and then HOLDS its response
 * until this replica has the rows, so the screen that re-reads after a save cannot see
 * the old data. The app knows exactly which models that write touched and needs an
 * answer back, so it asks over Postgres NOTIFY on the replica itself — no port, no
 * socket, nothing that crosses the LAN — and this module answers on a second channel
 * once the targeted cycle has committed.
 *
 * Payloads carry a request id and model names, never a row. An id the app is no longer
 * waiting for is simply ignored on its side; a model the registry does not know is
 * ignored on ours (sync-once.js says so in its log).
 *
 * Both channel names must match `src/shared/lib/counter/relayPolicy.ts`.
 */

const { Client } = require("pg");

/** App → worker: `{ id, models }`. */
const PULL_CHANNEL = "sync_pull_now";
/** Worker → app: `{ ids, ok }`. */
const DONE_CHANNEL = "sync_relay_done";

/** Wait before re-opening a dropped LISTEN connection. */
const RETRY_MS = 5000;
/** Ids per `sync_relay_done` notification: ~40 bytes each, well under the 8000-byte cap. */
const IDS_PER_NOTIFY = 100;

/**
 * Hold `LISTEN sync_pull_now` on its own connection and call `onPull({ id, models })`
 * per request. Never throws: the replica being unreachable degrades to "no targeted
 * pulls", and the Realtime signal and the interval still cover every write.
 *
 * Returns a stop function.
 */
function listen(cfg, onPull, log) {
    let stopped = false;
    let client = null;
    let retry = null;

    const connect = () => {
        if (stopped) return;
        const c = new Client({ connectionString: cfg.localUrl, connectionTimeoutMillis: 5000 });
        client = c;

        const drop = (why) => {
            if (client !== c) return;
            client = null;
            c.end().catch(() => {});
            if (stopped) return;
            log(`local signal: ${why} - reconnecting in ${RETRY_MS / 1000}s`);
            retry = setTimeout(connect, RETRY_MS);
        };

        c.on("notification", (msg) => {
            if (msg.channel !== PULL_CHANNEL || !msg.payload) return;
            let payload;
            try {
                payload = JSON.parse(msg.payload);
            } catch {
                return;
            }
            const id = payload && typeof payload.id === "string" ? payload.id : null;
            const models = payload && Array.isArray(payload.models)
                ? payload.models.filter((m) => typeof m === "string")
                : [];
            if (!id) return;
            try {
                onPull({ id, models });
            } catch (e) {
                log(`local signal: handler failed: ${e.message}`);
            }
        });
        c.on("error", (e) => drop(`error: ${e.message}`));
        c.on("end", () => drop("connection closed"));

        c.connect()
            .then(() => c.query(`LISTEN ${PULL_CHANNEL}`))
            .then(() => log(`local signal: listening on ${PULL_CHANNEL}`))
            .catch((e) => drop(`could not connect: ${e.message}`));
    };

    connect();

    return () => {
        stopped = true;
        if (retry) clearTimeout(retry);
        const c = client;
        client = null;
        if (c) c.end().catch(() => {});
    };
}

/**
 * Tell the app that the pulls carrying `ids` have finished. A fresh short-lived
 * connection each time: this runs once per targeted cycle, on localhost, and a
 * listening client must not also run queries.
 */
async function notifyDone(cfg, payload, log) {
    const c = new Client({ connectionString: cfg.localUrl, connectionTimeoutMillis: 5000 });
    try {
        await c.connect();
        // pg_notify refuses payloads over 8000 bytes, and a batch that queued up
        // behind a long cycle can hold hundreds of ids — so they go out in slices.
        const ids = Array.isArray(payload.ids) ? payload.ids : [];
        for (let i = 0; i < Math.max(ids.length, 1); i += IDS_PER_NOTIFY) {
            const slice = { ...payload, ids: ids.slice(i, i + IDS_PER_NOTIFY) };
            await c.query("SELECT pg_notify($1, $2)", [DONE_CHANNEL, JSON.stringify(slice)]);
        }
    } catch (e) {
        log(`local signal: could not report done: ${e.message}`);
    } finally {
        c.end().catch(() => {});
    }
}

module.exports = { listen, notifyDone, PULL_CHANNEL, DONE_CHANNEL };
