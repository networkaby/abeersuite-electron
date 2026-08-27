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

/** True only on a counter PC. Set by `electron/main.ts` from the actual outcome of
 *  `ensurePostgresRunning()` — not baked into the installer — and inherited by this
 *  process because the Next server is forked with the main process's env. */
export const IS_COUNTER_PC = process.env.COUNTER_PC === "1";

/** How long to wait before re-probing a live database we believe is down. */
const REPROBE_INTERVAL_MS = 15_000;

let mode: CounterMode = "LIVE";
let lastDemotedAt = 0;
let probing: Promise<void> | null = null;
let liveProbe: (() => Promise<boolean>) | null = null;

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
let replicaReady = false;
let readyCheckedAt = 0;

/** How long a readiness answer is trusted before asking the replica again. */
const READY_TTL_MS = 30_000;

export function setReplicaReady(ready: boolean): void {
    replicaReady = ready;
    readyCheckedAt = Date.now();
}

/** True when the cached readiness answer is old enough to be worth refreshing. */
export function readyIsStale(): boolean {
    return Date.now() - readyCheckedAt > READY_TTL_MS;
}

export function isReplicaReady(): boolean {
    return replicaReady;
}

/** Lets prismaClient supply a cheap `SELECT 1` against the live database. */
export function registerLiveProbe(fn: () => Promise<boolean>): void {
    liveProbe = fn;
}

export function getMode(): CounterMode {
    return mode;
}

/**
 * A live query failed with a transient connection error — stop paying that timeout
 * on every subsequent request. Called by prismaClient's retry extension once its
 * retries are exhausted.
 */
export function reportLiveDown(): void {
    if (mode === "LOCAL") return;
    mode = "LOCAL";
    lastDemotedAt = Date.now();
    console.warn("[counter] live database unreachable — serving reads from the local replica");
}

/** A live query succeeded, so we are back. Called on any successful live operation. */
export function reportLiveUp(): void {
    if (mode === "LIVE") return;
    mode = "LIVE";
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
let lastHeartbeatAt = 0;
let heartbeat: Promise<void> | null = null;

export function maybeHeartbeatLive(): void {
    if (mode !== "LIVE" || !liveProbe) return;
    if (Date.now() - lastHeartbeatAt < LIVE_HEARTBEAT_MS) return;
    if (heartbeat) return;

    lastHeartbeatAt = Date.now();
    heartbeat = liveProbe()
        .then((ok) => {
            if (!ok) reportLiveDown();
        })
        .catch(() => reportLiveDown())
        .finally(() => {
            heartbeat = null;
        });
}

/**
 * While demoted, re-probe on a timer so we notice recovery without waiting for a
 * write to fail. Fire-and-forget; never awaited on a request path.
 */
export function maybeReprobe(): void {
    if (mode !== "LOCAL" || !liveProbe) return;
    if (Date.now() - lastDemotedAt < REPROBE_INTERVAL_MS) return;
    if (probing) return;

    lastDemotedAt = Date.now();
    probing = liveProbe()
        .then((ok) => {
            if (ok) reportLiveUp();
        })
        .catch(() => {
            /* still down — the next tick tries again */
        })
        .finally(() => {
            probing = null;
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
    if (mode === "LOCAL") return true;
    if (!replicaReady) return false;
    return READ_PREFERENCE === "local" || READ_PREFERENCE === "shadow";
}

/** Snapshot for `/api/counter/status` and the shell badge. */
export function counterStatus(): {
    mode: CounterMode;
    preference: ReadPreference;
    replicaReady: boolean;
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
        mode, preference: READ_PREFERENCE, replicaReady, isCounter: IS_COUNTER_PC,
        replicaSource: source === "installed" || source === "embedded" ? source : null,
    };
}
