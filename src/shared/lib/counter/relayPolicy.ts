/**
 * The rules of the `WRITE_MODE=v_live` write relay — pure, and deliberately free of
 * Next, Prisma and `pg`.
 *
 * `writeRelay.ts` does the forwarding; this file decides what may be forwarded and
 * whether the relay is on at all. Kept apart so `scripts/check-counter-mode.ts` can
 * assert the boundary under plain `tsx` (the relay's own import chain reaches
 * `server-only`, which exists only inside a Next build), and so `src/proxy.ts` can
 * consult `RELAY_ACTIVE` without loading the relay on builds that never relay.
 *
 * See writeRelay.ts for the why of every rule.
 */

import { IS_COUNTER_PC, WRITE_API_URL, relaysWrites } from "@/shared/lib/prisma/counterMode";

/** Stamped on every relayed request. The office ignores it today; it is what stops a
 *  relayed request being relayed onward, and what lets a relayed error in the
 *  office's logs be traced back to a till. */
export const RELAY_HEADER = "x-abeer-relay";
/** App → worker: "pull these models now". Payload `{ id, models }`.
 *  Must match sync-engine/lib/localSignal.js. */
export const PULL_CHANNEL = "sync_pull_now";
/** Worker → app: "that pull finished". Payload `{ ids, ok }`. */
export const DONE_CHANNEL = "sync_relay_done";

/** Vercel refuses request bodies above 4.5 MB; stay under it with room to spare. A
 *  larger body (a bulk import) simply runs here, decided BEFORE anything is sent. */
export const MAX_RELAY_BODY_BYTES = 4 * 1024 * 1024;

/** True only on a counter PC that is configured to relay. Never on Vercel, which is
 *  what makes a misconfigured web deployment incapable of relaying to itself. */
export const RELAY_ACTIVE: boolean = relaysWrites() && IS_COUNTER_PC && WRITE_API_URL !== null;

/**
 * Paths that must act on THIS machine, whatever the mode says. Each one is a place
 * where relaying would be wrong rather than merely slow.
 */
const NEVER_RELAY: readonly RegExp[] = [
    /^\/api\/auth(\/|$)/,                        // sign-in mints this machine's cookie
    /^\/api\/counter(\/|$)/,                     // this PC's own status
    /^\/api\/health$/,                           // Electron's boot probe: relayed, a till with no internet never starts
    /^\/api\/sync(\/|$)/,                        // the outbox push is this machine's work
    /^\/api\/pos\/counters(\/|$)/,               // bind THIS device; already write authoritatively
    /^\/api\/settings\/(backup|restore)(\/|$)/,  // credentials withheld from tills on purpose
    // A PIN belongs to THIS counter, and the office is not one: relayed, `thisCounterId()`
    // answers null there and the route refuses its own till. Nothing is lost by staying
    // here — the write already goes through `prismaAuthoritative`, a direct Supabase
    // connection on a counter, so it still lands in the office books; and the status read
    // stays on the replica, which is what lets a PIN work with the line down.
    /^\/api\/counter-pin(\/|$)/,                 // "is there a PIN on this counter?"
    /^\/api\/me\/counter-pin(\/|$)/,             // set or remove one FOR this counter
];

/**
 * Writes that save nothing in our database — they only talk to an outside service — so
 * running them here skips the ~0.4s relay hop. Only when this till holds that service's
 * keys (office builds, `scripts/counterEnv.ts`); a till without them relays, and the
 * office answers. Never list a route that saves a row: that write belongs to the office.
 */
const LOCAL_WHEN_KEYED: readonly { path: RegExp; keys: readonly string[] }[] = [
    // AI product copy: reads one product from the replica, calls Gemini.
    { path: /^\/api\/ecommerce\/products\/ai-copy$/, keys: ["GOOGLE_GENERATIVE_AI_API_KEY"] },
    // WhatsApp attachment: signs an R2 upload URL; the browser uploads straight to R2.
    { path: /^\/api\/messages\/upload-url$/, keys: ["CLOUDFLARE_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"] },
];

const runsHereWithKeys = (pathname: string): boolean =>
    LOCAL_WHEN_KEYED.some((r) => r.path.test(pathname) && r.keys.every((k) => process.env[k]?.trim()));

export type RelaySkipReason =
    | "read" | "not-api" | "already-relayed" | "excluded"
    | "body-too-large" | "body-size-unknown";

export type RelayDecision = { relay: true } | { relay: false; reason: RelaySkipReason };

/**
 * Should a request with these properties be relayed?
 *
 * `contentLength` is `null` when the size cannot be known before reading the body
 * (a chunked upload) — those run here, because the size rule must be decided before
 * anything is sent.
 */
export function decideRelay(input: {
    method: string;
    pathname: string;
    contentLength: number | null;
    alreadyRelayed: boolean;
}): RelayDecision {
    const skip = (reason: RelaySkipReason): RelayDecision => ({ relay: false, reason });
    const method = input.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return skip("read");
    if (input.alreadyRelayed) return skip("already-relayed");
    // Every rule below runs on the path the OFFICE would route — percent-decoded and
    // dot-segment-normalised. Matching the raw path would let `/api/settings/%72estore`
    // slip past the exclusions and be decoded into the real route at the other end.
    const pathname = canonicalPath(input.pathname);
    if (pathname === null) return skip("excluded");
    if (!pathname.startsWith("/api/")) return skip("not-api");
    if (NEVER_RELAY.some((re) => re.test(pathname))) return skip("excluded");
    if (runsHereWithKeys(pathname)) return skip("excluded");
    // No segment allowlist beyond this point: every other write is the office's to
    // make. The old "relay boundary is the build boundary" rule let any segment the
    // counter build strips (customer-tools, accountancy, companies, …) run HERE on a
    // full build in counter mode — reading the replica but writing Supabase directly
    // from the till, the split that tried to hard-delete a tombstone the office no
    // longer had. The office authenticates every relayed call from the till's own
    // cookie and applies its own permissions, so forwarding a segment the counter
    // build does not serve opens nothing the office does not already gate.
    if (input.contentLength === null) return skip("body-size-unknown");
    if (input.contentLength > MAX_RELAY_BODY_BYTES) return skip("body-too-large");
    return { relay: true };
}

/** Percent-decode and normalise a request path; `null` when it cannot be decoded, which
 *  is treated as "do not relay". Any remaining `%` after decoding means double
 *  encoding, and is refused for the same reason. */
export function canonicalPath(pathname: string): string | null {
    let decoded: string;
    try {
        decoded = decodeURIComponent(pathname);
    } catch {
        return null;
    }
    if (decoded.includes("%") || decoded.includes("\\")) return null;
    try {
        return new URL(decoded, "http://relay.invalid").pathname;
    } catch {
        return null;
    }
}

/** The request body's size from its headers, `null` when it cannot be known up front. */
export function contentLengthOf(headers: Headers): number | null {
    const raw = headers.get("content-length");
    // No length and no chunked body means no body at all (a bare DELETE).
    if (raw === null) return headers.has("transfer-encoding") ? null : 0;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
}
