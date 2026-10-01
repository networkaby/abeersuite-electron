/**
 * Which database the counter PC is currently reading from, and why.
 *
 * On Vercel this module is inert: no `LOCAL_DATABASE_URL` means no replica, so the
 * mode is permanently LIVE and nothing here is ever consulted. It only comes alive
 * on a shop machine running its own Postgres replica (see prismaClient.ts).
 *
 * ── Deliberately free of Prisma imports ──────────────────────────────────────
 * prismaClient.ts imports THIS module, so importing it back would be a cycle. The
 * live-health probe is therefore injected via `registerLiveProbe()` rather than
 * built here — this file holds policy and state, prismaClient owns the connections.
 *
 * ── Demotion is failure-driven, not poll-driven ──────────────────────────────
 * Polling to ask "is Supabase up?" costs a round-trip on a schedule forever. Instead
 * a real query failing with a transient connection error demotes us (the request that
 * paid the cost is the one that tells us), and we only poll while DEMOTED, to find out
 * when to come back. Healthy operation costs nothing.
 */

import { parseCounterPc } from "@/shared/lib/appModeCore";

/** Where reads are actually being served from right now. */
export type CounterMode = "LIVE" | "LOCAL";

/**
 * Operator preference, from `READ_MODE`. Distinct from `CounterMode`: this is where
 * reads SHOULD go, the mode is where they CAN go. A live outage overrides preference.
 *
 *   live   — read Supabase (today's behaviour; the safe default and the ship state)
 *   shadow — read the replica but sample-compare against live, to prove the replica
 *            before trusting it (Phase 4)
 *   local  — read the replica; the egress win
 */
export type ReadPreference = "live" | "shadow" | "local";

export const READ_PREFERENCE: ReadPreference =
    process.env.READ_MODE === "local" ? "local"
        : process.env.READ_MODE === "shadow" ? "shadow"
            : "live";

/**
 * Where WRITES go, from `WRITE_MODE`. Independent of `READ_MODE`.
 *
 *   live   — write Supabase, falling back to the replica + outbox during an outage.
 *            Today's behaviour, and the escape hatch: one env var reverts a
 *            misbehaving till to it without a rebuild.
 *   local  — write the replica always; the outbox carries it up afterwards. The
 *            counter treats its own PostgreSQL the way the web app treats Supabase.
 *   v_live — `live`, with every non-GET `/api/*` call RELAYED to the office deployment
 *            (`WRITE_API_URL`) as one HTTP round trip instead of thirty-odd Prisma
 *            round trips across the WAN — see shared/lib/counter/writeRelay.ts.
 *            Below the relay it IS `live`: when the office cannot be reached the
 *            request runs here exactly as `live` would, with the same outage fallback.
 *            Needs `WRITE_API_URL`; without it the till degrades to `local`, never to
 *            the slow direct-to-Supabase path this mode exists to remove.
 *
 * ── How the two dials compose ───────────────────────────────────────────────
 * WRITE_MODE picks the base client; READ_MODE decides whether reads are redirected
 * off it. That ordering is not arbitrary — a `$transaction` is a write, so it opens
 * on the WRITE_MODE client, and a read inside it stays on that same database. Any
 * other arrangement could split a transaction across two databases.
 *
 * The distinction also decides whether the offline voucher-type policy applies. Under
 * `live` a local write means a temporary outage, which is what that policy was written
 * for. Under `local` it is simply where writes go, so enforcing it would permanently
 * refuse those voucher types rather than protect anything.
 */
export type WritePreference = "live" | "local" | "v_live";

/** The office deployment a `v_live` till relays its writes to. Origin only, no path. */
export const WRITE_API_URL: string | null = (() => {
    const raw = process.env.WRITE_API_URL?.trim();
    if (!raw) return null;
    try {
        const url = new URL(raw);
        if (url.protocol !== "https:" && url.protocol !== "http:") return null;
        return url.origin;
    } catch {
        return null;
    }
})();

function parseWritePreference(): WritePreference {
    const raw = process.env.WRITE_MODE;
    if (raw === "local") return "local";
    if (raw === "v_live") {
        if (WRITE_API_URL) return "v_live";
        // A half-configured till must fail SAFE: `local` keeps every save on this
        // machine, where it is fast and captured by the outbox. Degrading to `live`
        // would quietly reintroduce the WAN round trips the relay exists to remove.
        console.warn("[counter] WRITE_MODE=v_live but WRITE_API_URL is missing or not a URL — writing local instead.");
        return "local";
    }
    return "live";
}

export const WRITE_PREFERENCE: WritePreference = parseWritePreference();

/** True when a local write means "Supabase is unreachable", not "this is where we write".
 *  `v_live` counts: below the relay it is `live`, so a local write there is an outage too. */
export function localWriteIsFallback(): boolean {
    return WRITE_PREFERENCE !== "local";
}

/** True on a till that forwards its writes to the office (`WRITE_MODE=v_live`). */
export function relaysWrites(): boolean {
    return WRITE_PREFERENCE === "v_live";
}

/** True only on a counter PC. Set by `electron/main.ts` from the actual outcome of
 *  `ensurePostgresRunning()` — not baked into the installer — and inherited by this
 *  process because the Next server is forked with the main process's env. Accepts
 *  `true`/`false` (the form the `.env` documents) as well as the older `1`/`0`. */
export const IS_COUNTER_PC = parseCounterPc(process.env.COUNTER_PC) === true;

/** How long to wait before re-probing a live database we believe is down. */
const REPROBE_INTERVAL_MS = 15_000;

// ── State: one per server PROCESS, not per module copy ───────────────────────
//
// The bundler gives instrumentation (the outbox flusher, which reports a failed push
// with `reportLiveDown`), the proxy and each route handler their OWN copy of this
// module. With module-level state, a demotion recorded by one copy was invisible to
// the others — the flusher's "cloud unreachable" never reached /api/counter/status,
// so the shell badge could stay green through an outage. Parked on `globalThis`, the
// process has one mode, as it always meant to. Same pattern as replicaPull.ts.
type ModeState = {
    mode: CounterMode;
    lastDemotedAt: number;
    probing: Promise<void> | null;
    liveProbe: (() => Promise<boolean>) | null;
    /** See the note on readiness below. */
    replicaReady: boolean;
    replicaSchemaOk: boolean;
    readyCheckedAt: number;
    lastHeartbeatAt: number;
    heartbeat: Promise<void> | null;
};

const globalForMode = globalThis as unknown as { __counterMode?: ModeState };
const S: ModeState = (globalForMode.__counterMode ??= {
    mode: "LIVE",
    lastDemotedAt: 0,
    probing: null,
    liveProbe: null,
    replicaReady: false,
    replicaSchemaOk: true,
    readyCheckedAt: 0,
    lastHeartbeatAt: 0,
    heartbeat: null,
});

/**
 * Has the replica finished seeding and passed its first reconciliation?
 *
 * Gates local reads INDEPENDENTLY of `READ_MODE`, and that separation matters: a
 * half-seeded replica does not error, it just returns fewer rows — so a report would
 * render successfully with records silently missing, which reads as "those were
 * deleted" rather than "this database isn't ready". Until the worker says otherwise,
 * we only fall back to local when live is genuinely unreachable, where stale-but-
 * partial still beats a dead page.
 */
// (state: `S.replicaReady`, `S.replicaSchemaOk`, `S.readyCheckedAt` above)

/** How long a readiness answer is trusted before asking the replica again. */
const READY_TTL_MS = 30_000;

/**
 * Record the replica's own verdict.
 *
 * `schemaOk` is carried alongside because "not ready" has two very different causes
 * and only one of them clears on its own. A replica that is still filling will be
 * ready in minutes; a replica the worker has HALTED on schema drift will never be
 * ready, no matter how long anyone waits, because the fix is a new build. Defaults
 * to true so that an unknown answer (the worker has never run, no grant) reads as
 * "still catching up" rather than accusing a deploy that may be fine.
 */
export function setReplicaReady(ready: boolean, schemaOk: boolean = true): void {
    S.replicaReady = ready;
    S.replicaSchemaOk = schemaOk;
    S.readyCheckedAt = Date.now();
}

/** True when the cached readiness answer is old enough to be worth refreshing. */
export function readyIsStale(): boolean {
    return Date.now() - S.readyCheckedAt > READY_TTL_MS;
}

export function isReplicaReady(): boolean {
    return S.replicaReady;
}

/** Lets prismaClient supply a cheap `SELECT 1` against the live database. */
export function registerLiveProbe(fn: () => Promise<boolean>): void {
    S.liveProbe = fn;
}

export function getMode(): CounterMode {
    return S.mode;
}

/**
 * A live query failed with a transient connection error — stop paying that timeout
 * on every subsequent request. Called by prismaClient's retry extension once its
 * retries are exhausted.
 */
export function reportLiveDown(): void {
    if (S.mode === "LOCAL") return;
    S.mode = "LOCAL";
    S.lastDemotedAt = Date.now();
    console.warn("[counter] live database unreachable — serving reads from the local replica");
}

/** A live query succeeded, so we are back. Called on any successful live operation. */
export function reportLiveUp(): void {
    if (S.mode === "LIVE") return;
    S.mode = "LIVE";
    console.info("[counter] live database reachable again — reads restored to live");
}

/**
 * Confirm live is STILL reachable while every read is being served from the replica.
 *
 * ── Why the failure-driven design needs this one exception ───────────────────
 * Demotion above is driven by a real live query failing. That works while reads go
 * live. It stops working the moment `shouldReadLocal()` is true: reads are then
 * answered from the replica and return before touching Supabase, so no live query
 * ever runs, so nothing can ever fail, so `mode` stays LIVE forever — and the shell
 * badge stays green through a total outage. Writes now report their outcome too
 * (see prismaClient), but a counter can go a long time between writes, and "the
 * light was green until I tried to save" is exactly the failure the badge exists
 * to prevent.
 *
 * One `SELECT 1` per interval is a rounding error against the egress this mode
 * saves. Fire-and-forget; never awaited on a request path.
 */
const LIVE_HEARTBEAT_MS = 20_000;

export function maybeHeartbeatLive(): void {
    if (S.mode !== "LIVE" || !S.liveProbe) return;
    if (Date.now() - S.lastHeartbeatAt < LIVE_HEARTBEAT_MS) return;
    if (S.heartbeat) return;

    S.lastHeartbeatAt = Date.now();
    S.heartbeat = S.liveProbe()
        .then((ok) => {
            if (!ok) reportLiveDown();
        })
        .catch(() => reportLiveDown())
        .finally(() => {
            S.heartbeat = null;
        });
}

/**
 * While demoted, re-probe on a timer so we notice recovery without waiting for a
 * write to fail. Fire-and-forget; never awaited on a request path.
 */
export function maybeReprobe(): void {
    if (S.mode !== "LOCAL" || !S.liveProbe) return;
    if (Date.now() - S.lastDemotedAt < REPROBE_INTERVAL_MS) return;
    if (S.probing) return;

    S.lastDemotedAt = Date.now();
    S.probing = S.liveProbe()
        .then((ok) => {
            if (ok) reportLiveUp();
        })
        .catch(() => {
            /* still down — the next tick tries again */
        })
        .finally(() => {
            S.probing = null;
        });
}

/**
 * Should this read be served from the replica?
 *
 * Live being DOWN forces local regardless of preference — a stale page beats no page.
 * Otherwise the operator's preference decides, but only once the replica is proven
 * ready (see `replicaReady`).
 */
export function shouldReadLocal(): boolean {
    if (S.mode === "LOCAL") return true;
    if (!S.replicaReady) return false;
    return READ_PREFERENCE === "local" || READ_PREFERENCE === "shadow";
}

/**
 * A client's "changed since" stamp, or null when it must not be trusted.
 *
 * Every delta cache in the browser remembers the server's `computedAt` and next asks
 * only for rows with `updatedAt > since`. That is exact against the database that
 * stamped the rows. Against the REPLICA it is not: rows arrive there seconds after
 * Supabase stamped them, so a read that runs before the sync lands moves the stamp
 * past a row that then never qualifies again — the screen stays wrong until someone
 * presses Refresh. On a replica-served read the stamp is therefore ignored and the
 * route answers in full; the replica is local, so a full read costs nothing, and the
 * screen only re-reads on the worker's own "rows applied" signal anyway.
 *
 * Off a counter (Vercel, READ_MODE=live) this is the plain parse it always was.
 */
export function parseSince(raw: string | null): Date | null {
    if (!raw || shouldReadLocal()) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Should this WRITE be served by the replica?
 *
 * Under `WRITE_MODE=local` that is simply where writes go. Under `live` it happens
 * only while Supabase is unreachable, which is the fallback the outbox exists for.
 */
export function shouldWriteLocal(): boolean {
    return WRITE_PREFERENCE === "local" || S.mode === "LOCAL";
}

/** Snapshot for `/api/counter/status` and the shell badge. */
export function counterStatus(): {
    mode: CounterMode;
    preference: ReadPreference;
    writePreference: WritePreference;
    replicaReady: boolean;
    /** False when the sync worker has HALTED on schema drift — see `setReplicaReady`. */
    replicaSchemaOk: boolean;
    isCounter: boolean;
    /** Which PostgreSQL the replica is running against, set by electron/postgresManager.ts
     *  and forwarded into this process's env when the Next server was forked — null when
     *  there is no replica at all (the ship state today). Only ever "embedded" for now;
     *  "installed" returns when ALLOW_EXITING_DB is implemented alongside the installer
     *  work that collects the local server's credentials. */
    replicaSource: "installed" | "embedded" | null;
} {
    const source = process.env.LOCAL_DATABASE_SOURCE;
    return {
        mode: S.mode,
        preference: READ_PREFERENCE,
        writePreference: WRITE_PREFERENCE,
        replicaReady: S.replicaReady,
        replicaSchemaOk: S.replicaSchemaOk,
        isCounter: IS_COUNTER_PC,
        replicaSource: source === "installed" || source === "embedded" ? source : null,
    };
}
