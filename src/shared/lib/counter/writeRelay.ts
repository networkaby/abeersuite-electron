/**
 * The `WRITE_MODE=v_live` write path: a till forwards its writes to the office.
 *
 * ── Why ──────────────────────────────────────────────────────────────────────
 * A counter runs the whole app locally. Saving a bill against Supabase from here is
 * ~35 sequential Prisma round trips (plus two per cart line) across the WAN; the same
 * handler on Vercel sits beside the database and pays a millisecond a hop. So under
 * `v_live` the counter's own Next server relays every non-GET `/api/*` call to the
 * office deployment (`WRITE_API_URL`) as ONE round trip, and keeps serving reads from
 * its replica. The browser never knows: it still posts to 127.0.0.1, so there is no
 * CORS, no cookie problem and no UI change. `src/proxy.ts` calls `relayWrite()`.
 *
 * The office authenticates the relayed request from the SAME session cookie. That
 * works because the cookie name is pinned in `src/auth.ts` — Auth.js derives the
 * token's encryption key from the secret AND the cookie name — and `counter.env`
 * carries the office's `AUTH_SECRET`. The Cookie header is forwarded verbatim,
 * chunked cookies included.
 *
 * ── The duplicate-bill rule — the one hard part ──────────────────────────────
 * If the office commits a sale and the response is then lost, running the request
 * locally afterwards writes the bill a SECOND time under a new number, and nothing
 * would ever find it. So the local fallback is allowed only when the request provably
 * never reached the office: DNS, refused, TLS failure, connect timeout — anything
 * before the connection is up. After that point every failure is answered with a 502
 * and a plain sentence telling the cashier the bill may already be saved. An HTTP
 * error from the office is not a relay failure at all: it is the app's own answer (a
 * 403 means the office REFUSED) and is passed straight through — never run locally.
 * Two exceptions, both because the status did NOT come from the app: a 502–504 with
 * no JSON body is Vercel's gateway speaking (a function cut off mid-flight may already
 * have committed), so it gets the same "may already be saved" answer; and a bare 401
 * — "Unauthorized" without a `code` — means the office could not decrypt this till's
 * cookie at all, a configuration fault that runs locally and pauses the relay, while
 * a `SESSION_REVOKED` 401 is the app's verdict and passes through like any other.
 * Each relay opens its own connection (no keep-alive) so a stale pooled socket can
 * never turn "the server closed an idle connection" into an uncertain save.
 *
 * ── Read-your-write ──────────────────────────────────────────────────────────
 * A relayed row lands in Supabase, not in this replica, and screens re-read the
 * replica. So on success the relay asks the local sync worker for a targeted pull of
 * the models the path touched (Postgres NOTIFY — see sync-engine/lib/localSignal.js)
 * and holds the response until the worker reports the rows applied. Bounded, so a
 * stuck worker costs a few seconds and never a save; and timing out is safe, because
 * the browser's own change signal makes the worker pull moments later anyway.
 *
 * ── What is deliberately NOT relayed ─────────────────────────────────────────
 * Reads (they are the egress win). Every other write IS relayed, whatever segment it
 * sits under: a full build running in counter mode serves routes the counter build
 * strips, and those must reach the office too. The login (it mints THIS
 * machine's cookie), this machine's own status, boot probe and outbox push, the
 * counter-binding routes (they bind THIS device and already write authoritatively),
 * backup/restore (their credentials are withheld from tills on purpose), and bodies
 * above what Vercel accepts. A released or not-yet-set-up PC is not relayed either:
 * the office does not know it is talking to a counter, so this machine's own gates
 * are inert there — declining to relay lets the local route refuse exactly as today.
 * The path and size rules live in `relayPolicy.ts`, pure, so the check script can
 * assert them; this file is the mechanics.
 */

import * as http from "node:http";
import * as https from "node:https";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { WRITE_API_URL } from "@/shared/lib/prisma/counterMode";
import { isThisPcReleased, isThisPcWithoutCounter, readCounterSetup } from "@/shared/lib/counter/releaseGuard";
import { modelsForTopics, topicsForApiPath } from "@/shared/lib/realtime/topics";
import { DONE_CHANNEL, PULL_CHANNEL, RELAY_ACTIVE, RELAY_HEADER, contentLengthOf, decideRelay } from "./relayPolicy";
import { connectionErrorText } from "@/shared/lib/sync/connectionError";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client: PgClient, Pool: PgPool } = require("pg") as typeof import("pg");

// ── Tuning ───────────────────────────────────────────────────────────────────

/** A dead line is caught here, before anything is sent — so this one stays short. */
const CONNECT_TIMEOUT_MS = 2_000;
/** Matches the sale transaction's own `timeout: 30_000`. */
const RESPONSE_TIMEOUT_MS = 30_000;
/** After a connect failure, skip relaying for this long rather than paying the
 *  connect timeout on every bill of an office outage. */
const BREAKER_MS = 15_000;
/** After the office refuses this till's sign-in (401), skip relaying for this long:
 *  a secret or cookie-name mismatch is a configuration fault that a retry per bill
 *  cannot fix, and each attempt would otherwise bounce the cashier to the login page. */
const AUTH_BREAKER_MS = 60_000;
/** How long to hold a successful response for the worker's "rows applied". */
const PULL_WAIT_MS = 3_000;
/** Wait before re-opening a dropped LISTEN connection. */
const LISTEN_RETRY_MS = 5_000;

const UNCERTAIN_MESSAGE =
    "The office did not confirm this save. It may already be saved — check before entering it again.";

// ── Forwarding ───────────────────────────────────────────────────────────────

/** Hop-by-hop and origin-describing headers. `host`/`x-forwarded-*` matter most: the
 *  office runs `trustHost: true` and would otherwise compute its own base URL from a
 *  counter's loopback address. */
const STRIP_REQUEST = new Set([
    "host", "connection", "keep-alive", "transfer-encoding", "content-length", "expect",
    "upgrade", "accept-encoding",
    "x-forwarded-host", "x-forwarded-proto", "x-forwarded-for", "x-forwarded-port", "x-real-ip",
]);

/** The office's `set-cookie` never reaches the browser: this machine's sign-in is
 *  owned by this machine. Encoding/length headers describe the wire, not the body.
 *  Vercel's `strict-transport-security` would teach a browser that opened this till
 *  over the LAN by hostname to upgrade it to https — which nothing serves. */
const STRIP_RESPONSE = new Set([
    "set-cookie", "content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive",
    "strict-transport-security", "alt-svc",
]);

function outgoingHeaders(incoming: Headers, bodyLength: number): Record<string, string> {
    const out: Record<string, string> = {};
    incoming.forEach((value, key) => {
        if (!STRIP_REQUEST.has(key.toLowerCase())) out[key] = value;
    });
    // Plain bodies both ways: a decoded response is simpler to hand back than a
    // compressed one, and these are small JSON payloads.
    out["accept-encoding"] = "identity";
    if (bodyLength > 0) out["content-length"] = String(bodyLength);
    out[RELAY_HEADER] = "v_live";
    out["x-abeer-counter-machine"] = process.env.COUNTER_MACHINE_ID ?? "";
    out["x-abeer-counter-number"] = String(readCounterSetup()?.counterNumber ?? "");
    out["x-abeer-app-version"] = process.env.APP_VERSION ?? "";
    return out;
}

type OfficeReply = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };

/** `sent` is the whole classification: false means the connection was never up, so
 *  the office cannot have seen the request and running it here is safe. */
class RelayError extends Error {
    constructor(readonly code: string, readonly sent: boolean) {
        super(`relay ${code} (${sent ? "after the request was sent" : "before connecting"})`);
    }
}

/**
 * One request, one fresh connection, two timeouts: a short one while connecting and
 * a long one once the request is on the wire. Rejects with a `RelayError` whose
 * `sent` flag says which side of the line the failure fell on.
 */
function forward(target: URL, method: string, headers: Record<string, string>, body: Buffer | null): Promise<OfficeReply> {
    return new Promise((resolve, reject) => {
        const secure = target.protocol === "https:";
        const lib = secure ? https : http;
        let sent = false;

        const req = lib.request(target, { method, headers, agent: false }, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("end", () => resolve({ status: res.statusCode ?? 502, headers: res.headers, body: Buffer.concat(chunks) }));
            res.on("error", (err: NodeJS.ErrnoException) => reject(new RelayError(err.code ?? "response-error", true)));
        });

        req.on("socket", (socket) => {
            const armed = () => {
                sent = true;
                socket.setTimeout(RESPONSE_TIMEOUT_MS);
            };
            // One 'timeout' listener for both phases — `setTimeout(ms, cb)` would ADD a
            // listener per call, and the connect-phase one would then fire on a slow
            // response too and misfile it as "nothing was sent".
            socket.on("timeout", () => req.destroy(new RelayError(sent ? "response-timeout" : "connect-timeout", sent)));
            if (!socket.connecting) {
                armed();
                return;
            }
            socket.setTimeout(CONNECT_TIMEOUT_MS);
            // Application data cannot reach the server before the handshake completes,
            // so anything that fails before this event was never seen by the office.
            socket.once(secure ? "secureConnect" : "connect", armed);
        });
        req.on("error", (err: NodeJS.ErrnoException) => {
            reject(err instanceof RelayError ? err : new RelayError(err.code ?? err.message, sent));
        });

        if (body) req.write(body);
        req.end();
    });
}

function toResponse(reply: OfficeReply): NextResponse {
    const headers = new Headers();
    for (const [key, value] of Object.entries(reply.headers)) {
        if (value === undefined || STRIP_RESPONSE.has(key)) continue;
        if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
        else headers.set(key, value);
    }
    if (reply.status === 204 || reply.status === 304) return new NextResponse(null, { status: reply.status, headers });
    const bytes = new Uint8Array(reply.body.byteLength);
    bytes.set(reply.body);
    return new NextResponse(bytes, { status: reply.status, headers });
}

// ── Read-your-write: ask the worker to pull, wait for "applied" ──────────────

type Waiter = () => void;
const waiters = new Map<string, Waiter>();
let listener: InstanceType<typeof PgClient> | null = null;
let listenerReady = false;
let listenRetry: NodeJS.Timeout | null = null;
let notifier: InstanceType<typeof PgPool> | null = null;

/** Same shape as the flusher's listener: one dedicated client, reconnect with a
 *  backoff, never throws. Idempotent. */
function startListener(localUrl: string): void {
    if (listener) return;
    const client = new PgClient({ connectionString: localUrl, connectionTimeoutMillis: 5_000 });
    listener = client;

    const dropAndRetry = (why: string) => {
        if (listener !== client) return;
        listener = null;
        listenerReady = false;
        client.end().catch(() => { });
        console.warn(`[writeRelay] sync listener ${why}; reconnecting in ${LISTEN_RETRY_MS / 1000}s.`);
        listenRetry = setTimeout(() => {
            listenRetry = null;
            startListener(localUrl);
        }, LISTEN_RETRY_MS);
        listenRetry.unref?.();
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
            if (typeof id === "string") waiters.get(id)?.();
        }
    });
    client.on("error", (err) => dropAndRetry(`error: ${connectionErrorText(err)}`));
    client.on("end", () => dropAndRetry("connection closed"));
    client.connect()
        .then(() => client.query(`LISTEN ${DONE_CHANNEL}`))
        .then(() => {
            listenerReady = true;
            console.log(`[writeRelay] listening on ${DONE_CHANNEL}.`);
        })
        .catch((err: unknown) => dropAndRetry(`could not connect: ${connectionErrorText(err)}`));
}

function getNotifier(localUrl: string): InstanceType<typeof PgPool> {
    if (!notifier) {
        notifier = new PgPool({ connectionString: localUrl, max: 1, connectionTimeoutMillis: 5_000 });
        // A pool without an error listener turns an idle client's error into a crash.
        notifier.on("error", (err) => console.warn(`[writeRelay] notifier: ${err.message}`));
    }
    return notifier;
}

/**
 * Ask the worker to pull `models` and wait, bounded, for it to say they are applied.
 * Resolves — never rejects — because nothing here may fail a save that the office has
 * already committed. Without a replica (no `LOCAL_DATABASE_URL`) it is a no-op.
 */
async function pullAndWait(models: string[]): Promise<void> {
    const localUrl = process.env.LOCAL_DATABASE_URL;
    if (!localUrl || models.length === 0) return;
    startListener(localUrl);

    const id = randomUUID();
    const applied = new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
            waiters.delete(id);
            resolve();
        }, PULL_WAIT_MS);
        waiters.set(id, () => {
            clearTimeout(timer);
            waiters.delete(id);
            resolve();
        });
    });

    try {
        await getNotifier(localUrl).query("SELECT pg_notify($1, $2)", [PULL_CHANNEL, JSON.stringify({ id, models })]);
    } catch (err) {
        console.warn(`[writeRelay] could not ask the worker to pull: ${err instanceof Error ? err.message : String(err)}`);
        waiters.get(id)?.();
        return;
    }
    // The answer can only arrive on a live listener; without one the wait would just
    // be the full timeout for nothing.
    if (!listenerReady) {
        waiters.get(id)?.();
        return;
    }
    await applied;
}

// ── Entry point ──────────────────────────────────────────────────────────────

let breakerUntil = 0;

function bodyIsJson(reply: OfficeReply): boolean {
    const type = reply.headers["content-type"];
    return typeof type === "string" && /^application\/json\b/i.test(type);
}

/** `requireAuth()` marks a revoked session with `code: "SESSION_REVOKED"`; a 401
 *  without it is the generic "Unauthorized" — the cookie did not decode at all. */
function isRevokedSession(reply: OfficeReply): boolean {
    if (!bodyIsJson(reply)) return false;
    try {
        const body = JSON.parse(reply.body.toString("utf8")) as { code?: unknown };
        return body.code === "SESSION_REVOKED";
    } catch {
        return false;
    }
}

/**
 * Relay `req` to the office if this request should be relayed.
 *
 * Returns the office's response, a 502 when the outcome is unknowable, or `null` to
 * say "run this request here" — which is both the ordinary answer for everything
 * outside the relay's remit and the fallback when the office could not be reached.
 */
export async function relayWrite(req: NextRequest): Promise<Response | null> {
    if (!RELAY_ACTIVE) return null;
    const pathname = req.nextUrl.pathname;
    const contentLength = contentLengthOf(req.headers);
    const decision = decideRelay({
        method: req.method,
        pathname,
        contentLength,
        alreadyRelayed: req.headers.has(RELAY_HEADER),
    });
    if (!decision.relay) return null;
    if (Date.now() < breakerUntil) return null;
    if (isThisPcWithoutCounter() || (await isThisPcReleased())) return null;

    const target = new URL(pathname + req.nextUrl.search, WRITE_API_URL!);
    // Reading the body here does not starve the local route on fallback: Next tees
    // the stream for the proxy and hands the retained copy to the handler.
    const body = contentLength && contentLength > 0 ? Buffer.from(await req.arrayBuffer()) : null;

    let reply: OfficeReply;
    try {
        reply = await forward(target, req.method, outgoingHeaders(req.headers, body?.length ?? 0), body);
    } catch (err) {
        const code = err instanceof RelayError ? err.code : String(err);
        const sent = err instanceof RelayError ? err.sent : true;
        if (!sent) {
            breakerUntil = Date.now() + BREAKER_MS;
            console.warn(`[writeRelay] office unreachable (${code}) — ${req.method} ${pathname} runs here; relay paused ${BREAKER_MS / 1000}s.`);
            return null;
        }
        console.error(`[writeRelay] ${req.method} ${pathname} failed after the request was sent (${code}) — refusing the local fallback.`);
        // `error` carries the sentence: extractApiError() toasts that field, and a
        // wire code there would tell the cashier nothing. The code rides alongside.
        return NextResponse.json({ error: UNCERTAIN_MESSAGE, code: "relay_uncertain" }, { status: 502 });
    }

    if (reply.status === 401 && !isRevokedSession(reply)) {
        // A bare 401 means the office could not decrypt the cookie this till minted:
        // the secrets or the cookie name differ. (A revoked session says so with a
        // `code`, and is passed through below so the browser signs the cashier out.)
        // Nothing was written — requireAuth() runs before any work — so the request
        // runs here, where the local session check still applies, and the till keeps
        // billing instead of looping through the login page. Loud in the log, because
        // it means every write on this till is silently taking the slow path.
        breakerUntil = Date.now() + AUTH_BREAKER_MS;
        console.error(`[writeRelay] office could not read this till's session cookie (401) on ${req.method} ${pathname} — check AUTH_SECRET and a stray per-machine .env; relay paused ${AUTH_BREAKER_MS / 1000}s.`);
        return null;
    }
    if (reply.status >= 502 && reply.status <= 504 && !bodyIsJson(reply)) {
        // Not the app's answer: Vercel's gateway (or a proxy between) speaking for a
        // function it cut off, which may have committed before it was cut. Same class
        // as a lost response on our own leg, so the cashier gets the same sentence
        // rather than a raw HTML page that no toast can read.
        const gateway = reply.headers["x-vercel-error"] ?? "no JSON body";
        console.error(`[writeRelay] gateway ${reply.status} (${String(gateway)}) on ${req.method} ${pathname} — outcome unknown, refusing the local fallback.`);
        return NextResponse.json({ error: UNCERTAIN_MESSAGE, code: "relay_uncertain" }, { status: 502 });
    }
    if (reply.status >= 200 && reply.status < 300) {
        await pullAndWait(modelsForTopics(topicsForApiPath(pathname)));
    }
    return toResponse(reply);
}

// Open the "rows applied" line as soon as this module loads on a relaying counter, so
// the first save after boot is held for its pull like every later one — a listener
// started lazily by that first save could not have answered it.
if (RELAY_ACTIVE && process.env.LOCAL_DATABASE_URL) startListener(process.env.LOCAL_DATABASE_URL);
