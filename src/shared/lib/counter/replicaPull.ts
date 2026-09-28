/**
 * "Pull these models into this replica now, and tell me when they are in."
 *
 * A counter's replica learns about a row written to Supabase only when the sync
 * worker next pulls it. Most of the time that lag is harmless. Twice it is not:
 *
 *   • A relayed save (`WRITE_MODE=v_live`, see writeRelay.ts) lands in Supabase, and
 *     the screen that re-reads after it reads THIS replica — so the relay holds its
 *     response until the rows are here.
 *   • A session ended in Supabase (`User.tokensValidFrom`, stamped authoritatively by
 *     a sign-out or a role edit) goes on being accepted by this machine, which checks
 *     sign-ins against the replica. For as long as the two disagree the office refuses
 *     every save while this machine keeps serving pages: the cashier is thrown at the
 *     login page, the login page sends them straight back in, and a cookie cleared by
 *     Sign out can be put back by a page request already on its way. So the relay and
 *     the sign-out event both pull `User` the moment they know it changed.
 *
 * The ask goes over Postgres NOTIFY on the replica itself; the worker answers on a
 * second channel once the targeted cycle has committed (sync-engine/lib/localSignal.js
 * — its channel names must match `relayPolicy.ts`). Bounded, and it never throws:
 * a stuck or stopped worker costs a few seconds, never a save or a sign-out, and the
 * worker's own change signal and interval still bring the rows moments later.
 */

import { randomUUID } from "node:crypto";
import { IS_COUNTER_PC } from "@/shared/lib/prisma/counterMode";
import { connectionErrorText } from "@/shared/lib/sync/connectionError";
import { DONE_CHANNEL, PULL_CHANNEL } from "./relayPolicy";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client: PgClient, Pool: PgPool } = require("pg") as typeof import("pg");

/** How long to hold the caller for the worker's "rows applied" — the whole wait,
 *  including a listener that is still connecting. */
const PULL_WAIT_MS = 3_000;
/** Wait before re-opening a dropped LISTEN connection. */
const LISTEN_RETRY_MS = 5_000;

type Waiter = () => void;

/**
 * One listener per server PROCESS, not per module copy. The bundler gives the proxy
 * (which loads writeRelay) and each route (the sign-out event is in /api/auth) their
 * own copy of this module, so module-level state would mean a second LISTEN
 * connection — and one that is cold on the first sign-out after every start, the
 * very call that most needs the wait. Parked on `globalThis`, the relay's warm
 * listener answers the sign-out too.
 */
type PullState = {
    waiters: Map<string, Waiter>;
    listener: InstanceType<typeof PgClient> | null;
    listenerReady: boolean;
    /** Settles true once LISTEN is up, false if that attempt failed. */
    listening: Promise<boolean>;
    notifier: InstanceType<typeof PgPool> | null;
};

const globalForPull = globalThis as unknown as { __replicaPull?: PullState };
const state: PullState = (globalForPull.__replicaPull ??= {
    waiters: new Map(),
    listener: null,
    listenerReady: false,
    listening: Promise.resolve(false),
    notifier: null,
});

/** Same shape as the flusher's listener: one dedicated client, reconnect with a
 *  backoff, never throws. Idempotent. */
function startListener(localUrl: string): void {
    if (state.listener) return;
    const client = new PgClient({ connectionString: localUrl, connectionTimeoutMillis: 5_000 });
    state.listener = client;
    let settle: (up: boolean) => void = () => { };
    state.listening = new Promise<boolean>((resolve) => { settle = resolve; });

    const dropAndRetry = (why: string) => {
        if (state.listener !== client) return;
        state.listener = null;
        state.listenerReady = false;
        settle(false);
        client.end().catch(() => { });
        console.warn(`[replicaPull] sync listener ${why}; reconnecting in ${LISTEN_RETRY_MS / 1000}s.`);
        setTimeout(() => startListener(localUrl), LISTEN_RETRY_MS).unref?.();
    };

    client.on("notification", (msg) => {
        if (msg.channel !== DONE_CHANNEL || !msg.payload) return;
        let ids: unknown;
        try {
            ids = (JSON.parse(msg.payload) as { ids?: unknown }).ids;
        } catch {
            return;
        }
        if (!Array.isArray(ids)) return;
        for (const id of ids) {
            if (typeof id === "string") state.waiters.get(id)?.();
        }
    });
    client.on("error", (err) => dropAndRetry(`error: ${connectionErrorText(err)}`));
    client.on("end", () => dropAndRetry("connection closed"));
    client.connect()
        .then(() => client.query(`LISTEN ${DONE_CHANNEL}`))
        .then(() => {
            state.listenerReady = true;
            settle(true);
            console.log(`[replicaPull] listening on ${DONE_CHANNEL}.`);
        })
        .catch((err: unknown) => dropAndRetry(`could not connect: ${connectionErrorText(err)}`));
}

/** Is there a listener to hear the answer? One still connecting — the first call after
 *  this server started — is waited for, up to `deadline`: LISTEN has to be up BEFORE
 *  the ask goes out, or the worker's reply is missed and the wait runs out for nothing. */
async function listenerUp(localUrl: string, deadline: number): Promise<boolean> {
    startListener(localUrl);
    if (state.listenerReady) return true;
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), Math.max(0, deadline - Date.now()));
    });
    try {
        return await Promise.race([state.listening, late]);
    } finally {
        clearTimeout(timer);
    }
}

function getNotifier(localUrl: string): InstanceType<typeof PgPool> {
    if (!state.notifier) {
        state.notifier = new PgPool({ connectionString: localUrl, max: 1, connectionTimeoutMillis: 5_000 });
        // A pool without an error listener turns an idle client's error into a crash.
        state.notifier.on("error", (err) => console.warn(`[replicaPull] notifier: ${err.message}`));
    }
    return state.notifier;
}

/**
 * Ask the worker to pull `models` and wait, bounded, for it to say they are applied.
 * Resolves — never rejects — because nothing here may fail a save that the office has
 * already committed, or a sign-out. Without a replica (no `LOCAL_DATABASE_URL`, i.e.
 * the office) it is a no-op.
 */
export async function pullAndWait(models: string[]): Promise<void> {
    const localUrl = process.env.LOCAL_DATABASE_URL;
    if (!localUrl || models.length === 0) return;
    const deadline = Date.now() + PULL_WAIT_MS;
    const live = await listenerUp(localUrl, deadline);

    const id = randomUUID();
    const applied = new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
            state.waiters.delete(id);
            resolve();
        }, Math.max(0, deadline - Date.now()));
        state.waiters.set(id, () => {
            clearTimeout(timer);
            state.waiters.delete(id);
            resolve();
        });
    });

    try {
        await getNotifier(localUrl).query("SELECT pg_notify($1, $2)", [PULL_CHANNEL, JSON.stringify({ id, models })]);
    } catch (err) {
        console.warn(`[replicaPull] could not ask the worker to pull: ${err instanceof Error ? err.message : String(err)}`);
        state.waiters.get(id)?.();
        return;
    }
    // The answer can only arrive on a live listener; without one the wait would just
    // be the full timeout for nothing. The pull itself is still on its way.
    if (!live) {
        state.waiters.get(id)?.();
        return;
    }
    await applied;
}

// Open the "rows applied" line as soon as the first copy of this module loads on a
// counter, so a caller seldom has to wait for it to connect. On a relaying till that is
// the first API call after boot (writeRelay imports it); elsewhere, the first sign-out,
// which then waits for the connection inside its own budget (`listenerUp`).
if (IS_COUNTER_PC && process.env.LOCAL_DATABASE_URL) startListener(process.env.LOCAL_DATABASE_URL);
