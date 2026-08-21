import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { OfflineWriteBlockedError } from "./offlineError";
import {
    getMode,
    maybeReprobe,
    registerLiveProbe,
    reportLiveDown,
    reportLiveUp,
    shouldReadLocal,
} from "./counterMode";

// ── Two databases, or one ───────────────────────────────────────────────────
// DATABASE_URL is Supabase — the source of truth, and on Vercel the only database
// there is. LOCAL_DATABASE_URL is set ONLY on a shop counter PC running its own
// Postgres replica; when it is absent every export below collapses to exactly the
// single-client behaviour this file has always had, with no Proxy and no extra
// indirection on the hot path. That equivalence is deliberate: production must not
// pay for a feature only the counter uses.
function normalize(url: string | undefined): string | undefined {
    return url?.replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
}

const liveUrl = normalize(process.env.DATABASE_URL);
const localUrl = normalize(process.env.LOCAL_DATABASE_URL);

// Local Postgres (localhost) speaks plaintext — forcing SSL there fails the
// handshake. Supabase/remote needs SSL. Detect by host so dev-on-localhost and
// prod-on-Supabase both work from the same client.
function isLocalHost(url: string | undefined): boolean {
    return /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url ?? "");
}

// On Vercel serverless: prefer the Supabase pooler URL (port 6543, pgbouncer transaction mode)
// in DATABASE_URL. With pooler, max can stay modest per container. Without pooler, raising max
// risks exhausting Postgres' direct-connection limit under concurrent invocations.
function createPool(connectionString: string | undefined): Pool {
    const pool = new Pool({
        connectionString,
        ssl: isLocalHost(connectionString) ? false : { rejectUnauthorized: false },
        max: 10,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 10000,
        // The Supabase pooler (and intervening NAT/firewalls) silently close idle
        // connections. Without TCP keepalive, pg hands out a connection the server has
        // already dropped → the next query dies with "Connection terminated unexpectedly".
        // keepAlive probes keep the socket alive and surface a dead one early.
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000,
        // Recycle a physical connection after many uses so a long-lived stale one can't
        // linger in the pool indefinitely.
        maxUses: 7500,
    });

    // A pooled connection can die in the background (pooler idle-kill, network blip).
    // Without a handler that idle-client 'error' is unhandled and can crash the process;
    // with it, pg just removes the dead client and the next checkout gets a fresh one.
    pool.on("error", (err) => {
        console.warn("[pg pool] idle client error (connection will be recycled):", err.message);
    });
    return pool;
}

// ── Connection-drop resilience ──────────────────────────────────────────────
// Even with keepAlive, a connection can be killed in the gap between checkouts, so
// the FIRST query on it fails with a transient "Connection terminated" error. We
// retry — but ONLY read operations, which are idempotent and can never double-write.
// Writes and transactions are deliberately NOT auto-retried (a write that died after
// reaching the server but before the ack could otherwise be applied twice).
export const READ_OPS = new Set([
    "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow",
    "findMany", "count", "aggregate", "groupBy",
]);

function isTransientConnError(e: unknown): boolean {
    const msg = e instanceof Error ? e.message : String(e ?? "");
    return /Connection terminated|connection timeout|Closed the connection|server closed the connection|ECONNRESET|ETIMEDOUT/i.test(msg);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// $extends narrows the return type to DynamicClientExtensionThis (it drops $on/$use
// etc.), which is NOT assignable to PrismaClient — and dozens of helpers across the
// codebase are typed to accept PrismaClient. The retry extension only adds runtime
// behavior on read ops; every model delegate is still present at runtime, so we
// assert the wrapped client back to PrismaClient. Type-only; no runtime effect.
function createLive(): PrismaClient {
    const basePrisma = new PrismaClient({ adapter: new PrismaPg(createPool(liveUrl)) });
    return basePrisma.$extends({
        name: "retry-reads-on-conn-drop",
        query: {
            $allModels: {
                async $allOperations({ operation, args, query }) {
                    if (!READ_OPS.has(operation)) return query(args);
                    let lastErr: unknown;
                    for (let attempt = 0; attempt < 3; attempt++) {
                        try {
                            const out = await query(args);
                            // A success proves the live database is reachable. Only
                            // meaningful on a counter that had demoted itself; a no-op
                            // everywhere else.
                            if (localClient) reportLiveUp();
                            return out;
                        } catch (e) {
                            lastErr = e;
                            if (!isTransientConnError(e)) throw e;
                            await sleep(120 * (attempt + 1));
                        }
                    }
                    // Retries exhausted on a transient fault. On a counter this is the
                    // signal to stop paying the timeout on every later request; the
                    // caller still sees the error, but the NEXT read is served locally.
                    if (localClient) reportLiveDown();
                    throw lastErr;
                },
            },
        },
    }) as unknown as PrismaClient;
}

/**
 * The replica client. Physically incapable of accepting a write.
 *
 * The replica is a mirror of Supabase, and the sync worker will overwrite anything
 * it finds there. A write that landed here would therefore look like it succeeded,
 * be invisible to every other machine, and then vanish at the next sync — the worst
 * possible failure shape, because nothing reports it. So writes are refused loudly
 * instead.
 *
 * This extension is belt; the braces are the `SELECT`-only Postgres role the app
 * connects as. Either alone would do; both means a mistake in one is caught by
 * the other.
 */
function createLocal(): PrismaClient {
    const basePrisma = new PrismaClient({ adapter: new PrismaPg(createPool(localUrl)) });
    return basePrisma.$extends({
        name: "replica-is-read-only",
        query: {
            $allModels: {
                async $allOperations({ model, operation, args, query }) {
                    if (!READ_OPS.has(operation)) {
                        throw new OfflineWriteBlockedError(model ?? "unknown", operation);
                    }
                    return query(args);
                },
            },
            // Raw escape hatches bypass $allModels entirely, so they need their own
            // guards. $queryRaw is a read and passes through; $executeRaw is not.
            async $executeRaw({ args, query }) {
                void args; void query;
                throw new OfflineWriteBlockedError("$executeRaw", "executeRaw");
            },
            async $executeRawUnsafe({ args, query }) {
                void args; void query;
                throw new OfflineWriteBlockedError("$executeRawUnsafe", "executeRawUnsafe");
            },
        },
    }) as unknown as PrismaClient;
}

// In dev, Next.js HMR re-evaluates this module on every edit. Without a cache, each
// reload builds a fresh pg Pool (max 10) that is never closed, so open connections
// pile up across reloads until the database refuses new ones ("timeout exceeded when
// trying to connect"). Cache the client on globalThis so every reload reuses one pool.
// Production containers are short-lived and single-instance, so no caching there.
const globalForPrisma = globalThis as unknown as {
    __prisma?: PrismaClient;
    __prismaLocal?: PrismaClient;
};

/** Supabase. Always present. Use directly when a read MUST be authoritative. */
export const prismaLive: PrismaClient = globalForPrisma.__prisma ?? createLive();

/** The counter's replica, or null everywhere else. */
const localClient: PrismaClient | null = localUrl
    ? (globalForPrisma.__prismaLocal ?? createLocal())
    : null;

if (process.env.NODE_ENV !== "production") {
    globalForPrisma.__prisma = prismaLive;
    if (localClient) globalForPrisma.__prismaLocal = localClient;
}

if (localClient) {
    // Cheap liveness check used only while demoted, to notice recovery.
    registerLiveProbe(async () => {
        try {
            await prismaLive.$queryRaw`SELECT 1`;
            return true;
        } catch {
            return false;
        }
    });
}

/**
 * The client the whole app imports.
 *
 * ── Why the Proxy hands back the delegate RAW ────────────────────────────────
 * The obvious implementation — return a wrapper that picks a client per operation —
 * silently breaks the array form of `$transaction`. That form requires genuine
 * `PrismaPromise` objects produced by one client instance; a wrapper returning native
 * promises fails at runtime with "Invalid $transaction invocation". Six call sites use
 * it (including a plain read report at api/accountancy/ledgers), `$transaction` appears
 * ~105 times overall, `$queryRaw` tagged templates carry the same requirement, and
 * hundreds of helpers take `prisma` typed as `PrismaClient`.
 *
 * So the choice happens at PROPERTY ACCESS: we pick a client, then hand back its real
 * delegate untouched. Everything downstream — promise identity, transactions, raw
 * templates — behaves exactly as it does against a plain client, because it IS one.
 *
 * The cost of that choice: mode is per-client, not per-operation, so while reads are
 * being served locally a write also reaches the local client — where it is refused
 * rather than misapplied. That is correct when live is genuinely down (the write
 * could not have succeeded anyway), and it is why flipping READ_MODE to `local`
 * while online needs the separate mechanism in Phase 4 rather than this switch.
 */
export const prisma: PrismaClient = localClient
    ? new Proxy({} as PrismaClient, {
        get(_target, prop, receiver) {
            maybeReprobe();
            const client = getMode() === "LOCAL" ? localClient : prismaLive;
            return Reflect.get(client, prop, receiver);
        },
        has(_target, prop) {
            return Reflect.has(getMode() === "LOCAL" ? localClient : prismaLive, prop);
        },
    })
    : prismaLive;

/**
 * Read-path client for hot, repeatedly-fetched data — the egress lever.
 *
 * Supabase bills per row that leaves it, so a report opened fifty times is billed
 * fifty times. Pointing a read at the replica pulls each changed row ONCE and serves
 * it locally thereafter. Migrate hot GET routes here one at a time, each verified in
 * shadow mode, rather than flipping everything at once.
 *
 * NEVER use this for a read whose result authorises a write (credit limit, FIFO
 * allocation, stock at sale time, loyalty balance, coupon or gift-card validity).
 * Those must see the authoritative row — import `prismaLive` explicitly there.
 */
export const prismaRead: PrismaClient = localClient
    ? new Proxy({} as PrismaClient, {
        get(_target, prop, receiver) {
            maybeReprobe();
            const client = shouldReadLocal() ? localClient : prismaLive;
            return Reflect.get(client, prop, receiver);
        },
        has(_target, prop) {
            return Reflect.has(shouldReadLocal() ? localClient : prismaLive, prop);
        },
    })
    : prismaLive;
