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
 * The office authenticates the relayed request by this COUNTER, not by the cashier's
 * cookie: `Authorization: Counter <id>.<key>` (`relayKey.ts`) plus the user id of the
 * till's own, still-valid session. The cookie never leaves the till — it is signed
 * with this machine's own secret and means nothing at the office. The office half is
 * `auth/counterRelayAuth.ts`. A till with no valid session, or no key, does not relay:
 * the request runs here and the local route answers as it would anyway.
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
 * — "Unauthorized" without a `code`, or `COUNTER_KEY_REFUSED` — means the office did
 * not accept this till at all (an office deployment older than the counter key, or a
 * revoked key), which runs locally and pauses the relay, while a `SESSION_REVOKED`
 * 401 is the app's verdict and passes through like any other.
 * Each relay opens its own connection (no keep-alive) so a stale pooled socket can
 * never turn "the server closed an idle connection" into an uncertain save.
 * That covers one attempt. The cashier's NEXT Save of the same bill is covered by its
 * bill key: a key whose answer was uncertain is remembered, and while it is, that bill
 * never runs here — not on a connect failure, the breaker or a refused sign-in — it
 * waits for the office ("Bill keys whose save is uncertain", relayPolicy.ts).
 *
 * ── Read-your-write ──────────────────────────────────────────────────────────
 * A relayed row lands in Supabase, not in this replica, and screens re-read the
 * replica. So on success the relay asks the local sync worker for a targeted pull of
 * the models the path touched (Postgres NOTIFY — see sync-engine/lib/localSignal.js)
 * and holds the response until the worker reports the rows applied. Bounded, so a
 * stuck worker costs a few seconds and never a save; and timing out is safe, because
 * the browser's own change signal makes the worker pull moments later anyway. The
 * pull itself lives in `replicaPull.ts`, shared with the sign-out event.
 *
 * The same pull runs when the office answers `SESSION_REVOKED`: the office judged the
 * session against Supabase, this machine judges its pages against the replica, and
 * until the replica has the new `User.tokensValidFrom` the two disagree — the login
 * page would send the cashier straight back into the app, and the next save would
 * throw them out again, round and round.
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
import { NextResponse, type NextRequest } from "next/server";
import { WRITE_API_URL } from "@/shared/lib/prisma/counterMode";
import { isThisPcReleased, isThisPcWithoutCounter, readCounterSetup } from "@/shared/lib/counter/releaseGuard";
import { modelsForTopics, topicsForApiPath } from "@/shared/lib/realtime/topics";
import { RELAY_ACTIVE, RELAY_HEADER, UncertainBillKeys, billKeyOf, contentLengthOf, decideRelay } from "./relayPolicy";
import { pullAndWait } from "./replicaPull";
import { publishChangeServer } from "@/shared/lib/realtime/serverPublish";
import { getToken } from "next-auth/jwt";
import { isStaffTokenRevoked, SESSION_COOKIE_NAME } from "@/auth";
import { ACTING_USER_HEADER, COUNTER_KEY_REFUSED } from "@/shared/lib/auth/counterRelayAuth";
import { counterAuthorization, forgetCounterKey } from "./relayKey";

// ── Tuning ───────────────────────────────────────────────────────────────────

/** A dead line is caught here, before anything is sent — so this one stays short. */
const CONNECT_TIMEOUT_MS = 2_000;
/** Matches the sale transaction's own `timeout: 30_000`. */
const RESPONSE_TIMEOUT_MS = 30_000;
/** After a connect failure, skip relaying for this long rather than paying the
 *  connect timeout on every bill of an office outage. */
const BREAKER_MS = 15_000;
/** After the office refuses this till's sign-in (401), skip relaying for this long:
 *  a revoked key or an office older than counter keys is not something a retry per bill
 *  cannot fix, and each attempt would otherwise bounce the cashier to the login page. */
const AUTH_BREAKER_MS = 60_000;

const UNCERTAIN_MESSAGE =
    "The office did not confirm this save. It may already be saved — check before entering it again.";
/** A retried bill whose earlier try may be saved at the office, while the office is
 *  unreachable — see "Bill keys whose save is uncertain" in relayPolicy.ts. */
const UNCERTAIN_OFFLINE_MESSAGE =
    "This bill may already be saved at the office. Wait for the connection to come back, then press Save again.";

// ── Forwarding ───────────────────────────────────────────────────────────────

/** Hop-by-hop and origin-describing headers. `host`/`x-forwarded-*` matter most: the
 *  office runs `trustHost: true` and would otherwise compute its own base URL from a
 *  counter's loopback address. */
const STRIP_REQUEST = new Set([
    // This till's own sign-in: its cookie is signed with this machine's secret, and
    // the office is signed in to with the counter key instead.
    "cookie", "authorization", "x-abeer-acting-user",
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

function outgoingHeaders(incoming: Headers, bodyLength: number, signIn: OfficeSignIn): Record<string, string> {
    const out: Record<string, string> = {};
    incoming.forEach((value, key) => {
        if (!STRIP_REQUEST.has(key.toLowerCase())) out[key] = value;
    });
    out.authorization = signIn.authorization;
    out[ACTING_USER_HEADER] = signIn.userId;
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

// ── Signing in at the office ─────────────────────────────────────────────────

type OfficeSignIn = { authorization: string; userId: string };

/** The counter key plus the person whose till session made this request — or null
 *  when there is no valid session here (the local route will refuse it) or no key
 *  (revoked, or never registered while the database was out of reach). */
async function officeSignIn(req: NextRequest): Promise<OfficeSignIn | null> {
    const token = await getToken({
        req,
        secret: process.env.AUTH_SECRET,
        cookieName: SESSION_COOKIE_NAME,
        salt: SESSION_COOKIE_NAME,
    }).catch(() => null);
    if (!token?.id || token.kind === "customer" || (await isStaffTokenRevoked(token))) return null;
    // The env super admin's authority lives in env, not the database, so the office
    // could not rebuild it — its saves run here.
    const permissions = Array.isArray(token.permissions) ? token.permissions : [];
    if (permissions.includes("admin:bypass") && token.roleLabel === "Super Admin") return null;
    const authorization = await counterAuthorization();
    return authorization ? { authorization, userId: String(token.id) } : null;
}

/** The office's answer code on a 401, or null when it carries none. */
function replyCode(reply: OfficeReply): string | null {
    if (!bodyIsJson(reply)) return null;
    try {
        const body = JSON.parse(reply.body.toString("utf8")) as { code?: unknown };
        return typeof body.code === "string" ? body.code : null;
    } catch {
        return null;
    }
}

// ── Entry point ──────────────────────────────────────────────────────────────

let breakerUntil = 0;
const uncertainKeys = new UncertainBillKeys();

function bodyIsJson(reply: OfficeReply): boolean {
    const type = reply.headers["content-type"];
    return typeof type === "string" && /^application\/json\b/i.test(type);
}

/** `requireAuth()` (and the counter-key check, for someone HR marked as left) marks
 *  a dead session with `code: "SESSION_REVOKED"`. */
function isRevokedSession(reply: OfficeReply): boolean {
    return replyCode(reply) === "SESSION_REVOKED";
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
    // Reading the body here does not starve the local route on fallback: Next tees
    // the stream for the proxy and hands the retained copy to the handler. Read before
    // any fallback, because the bill key in it decides whether one may run here.
    const body = contentLength && contentLength > 0 ? Buffer.from(await req.arrayBuffer()) : null;
    const billKey = billKeyOf(pathname, body?.toString("utf8") ?? null);
    // Every "run it here" below the relay decision goes through this: a bill whose
    // earlier try may already be saved at the office waits for the office instead.
    const runHere = (): Response | null =>
        uncertainKeys.has(billKey, Date.now())
            ? NextResponse.json({ error: UNCERTAIN_OFFLINE_MESSAGE, code: "relay_uncertain_offline" }, { status: 503 })
            : null;
    if (Date.now() < breakerUntil) return runHere();
    if (isThisPcWithoutCounter() || (await isThisPcReleased())) return null;
    const signIn = await officeSignIn(req);
    if (!signIn) return runHere();

    const target = new URL(pathname + req.nextUrl.search, WRITE_API_URL!);

    let reply: OfficeReply;
    try {
        reply = await forward(target, req.method, outgoingHeaders(req.headers, body?.length ?? 0, signIn), body);
    } catch (err) {
        const code = err instanceof RelayError ? err.code : String(err);
        const sent = err instanceof RelayError ? err.sent : true;
        if (!sent) {
            breakerUntil = Date.now() + BREAKER_MS;
            console.warn(`[writeRelay] office unreachable (${code}) — ${req.method} ${pathname} runs here; relay paused ${BREAKER_MS / 1000}s.`);
            return runHere();
        }
        console.error(`[writeRelay] ${req.method} ${pathname} failed after the request was sent (${code}) — refusing the local fallback.`);
        uncertainKeys.remember(billKey, Date.now());
        // `error` carries the sentence: extractApiError() toasts that field, and a
        // wire code there would tell the cashier nothing. The code rides alongside.
        return NextResponse.json({ error: UNCERTAIN_MESSAGE, code: "relay_uncertain" }, { status: 502 });
    }

    if (reply.status === 401 && !isRevokedSession(reply)) {
        // A bare 401 or COUNTER_KEY_REFUSED: the office did not accept this till — an
        // office deployment older than the counter key (it ignores the key and sees no
        // cookie), or a revoked key. (A revoked session says so with its own `code`,
        // and is passed through below so the browser signs the cashier out.)
        // Nothing was written — requireAuth() runs before any work — so the request
        // runs here, where the local session check still applies, and the till keeps
        // billing instead of looping through the login page. Loud in the log, because
        // it means every write on this till is silently taking the slow path.
        breakerUntil = Date.now() + AUTH_BREAKER_MS;
        if (replyCode(reply) === COUNTER_KEY_REFUSED) forgetCounterKey();
        console.error(`[writeRelay] office did not accept this counter (401 ${replyCode(reply) ?? "no code"}) on ${req.method} ${pathname} — key revoked, or the office deployment predates counter keys; relay paused ${AUTH_BREAKER_MS / 1000}s.`);
        return runHere();
    }
    if (reply.status === 401) {
        // Revoked. Bring the new `User.tokensValidFrom` into the replica BEFORE the
        // browser hears it, so the login page it is about to open agrees with the
        // office instead of sending the cashier straight back into the app.
        await pullAndWait(["User"]);
    }
    if (reply.status >= 502 && reply.status <= 504 && !bodyIsJson(reply)) {
        // Not the app's answer: Vercel's gateway (or a proxy between) speaking for a
        // function it cut off, which may have committed before it was cut. Same class
        // as a lost response on our own leg, so the cashier gets the same sentence
        // rather than a raw HTML page that no toast can read.
        const gateway = reply.headers["x-vercel-error"] ?? "no JSON body";
        console.error(`[writeRelay] gateway ${reply.status} (${String(gateway)}) on ${req.method} ${pathname} — outcome unknown, refusing the local fallback.`);
        uncertainKeys.remember(billKey, Date.now());
        return NextResponse.json({ error: UNCERTAIN_MESSAGE, code: "relay_uncertain" }, { status: 502 });
    }
    if ((reply.status === 404 || reply.status === 405) && !bodyIsJson(reply)) {
        // Next's own "no such route" page, not an app answer: this counter is newer
        // than the office and posted to a route the office does not have yet. Say so —
        // the toast would otherwise show the route's generic failure text, which reads
        // as a bug in the feature rather than an office deploy that has not happened.
        console.error(`[writeRelay] office has no ${req.method} ${pathname} (${reply.status}) — the office deployment is older than this counter.`);
        return NextResponse.json(
            { error: "The office app is older than this counter and does not know this action yet. Update the office deployment, then try again.", code: "relay_office_outdated" },
            { status: 502 },
        );
    }
    if (reply.status >= 200 && reply.status < 300) {
        // Saved, or "already saved": the office has answered for this bill key. An
        // error answer keeps it — a 403 or a 400 comes from the sign-in or body checks
        // that run before the route's key check, so it proves nothing about the earlier try.
        uncertainKeys.forget(billKey);
        const topics = topicsForApiPath(pathname);
        // The office announces nothing for a relayed save (it has no browser in the
        // path) and this till's browser is silent while it reads the replica — so the
        // relay is the one place that knows the save landed. Best-effort, not awaited.
        void publishChangeServer(topics);
        await pullAndWait(modelsForTopics(topics));
    }
    return toResponse(reply);
}
