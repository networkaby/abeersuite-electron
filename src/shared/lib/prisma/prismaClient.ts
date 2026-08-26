import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { OfflineWriteBlockedError } from "./offlineError";
import {
    getMode,
    maybeReprobe,
    readyIsStale,
    registerLiveProbe,
    reportLiveDown,
    reportLiveUp,
    setReplicaReady,
    shouldReadLocal,
    IS_COUNTER_PC,
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
    // P1001 "Can't reach database server" fires when the network is down — a
    // counter PC going offline hits this before any TCP-level error appears.
    return /Connection terminated|connection timeout|Closed the connection|server closed the connection|ECONNRESET|ETIMEDOUT|Can't reach database/i.test(msg);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// $extends narrows the return type to DynamicClientExtensionThis (it drops $on/$use
// etc.), which is NOT assignable to PrismaClient — and dozens of helpers across the
// codebase are typed to accept PrismaClient. The retry extension only adds runtime
// behavior on read ops; every model delegate is still present at runtime, so we
// assert the wrapped client back to PrismaClient. Type-only; no runtime effect.
/**
 * Refreshes `replicaReady` from the replica's own `_sync_status` row, in the same module
 * that reads the flag.
 *
 * `shouldReadLocal()` gates every read below, and needs BOTH `READ_MODE=local` and
 * `replicaReady`. That flag starts false on every boot, so something has to turn it on —
 * and where that "something" lives turned out to matter more than expected:
 *
 *   - Originally only `GET /api/counter/status` refreshed it, polled by
 *     `CounterStatusBadge`. The entire egress saving therefore hung off a status widget
 *     being mounted; until a staff member opened a page carrying it, every read went to
 *     Supabase.
 *   - Moving it into `instrumentation.ts` looked like the fix, but did not work: the
 *     instrumentation hook and the route handlers do not reliably share module state, so
 *     the flag that got set was not the flag the reads consult. Measured — the watch was
 *     provably ticking while a `User` lookup still went live.
 *
 * Doing it here removes the question entirely: the code that needs the answer is the code
 * that fetches it, in one module instance.
 *
 * Cost is bounded by the 30s TTL in `counterMode.ts` — `readyIsStale()` is a timestamp
 * comparison, so the overwhelming majority of reads add one integer compare and nothing
 * else. At most one small query per TTL, against the LOCAL database, never Supabase.
 *
 * Fails CLOSED: any error leaves the replica not-ready and reads keep going to Supabase.
 * `_sync_status` is written by the sync worker after each cycle, so an absent table, a
 * missing grant, or a worker that has never run all resolve to "not ready" — slow and
 * correct beats fast and wrong.
 */
async function refreshReplicaReadinessInline(): Promise<void> {
    if (!IS_COUNTER_PC || !localClient || !readyIsStale()) return;
    try {
        const rows = await localClient.$queryRaw<{ ready: boolean }[]>`
            SELECT ready FROM "_sync_status" WHERE only_row
        `;
        setReplicaReady(rows.length > 0 && rows[0].ready === true);
    } catch {
        setReplicaReady(false);
    }
}

function createLive(): PrismaClient {
    const basePrisma = new PrismaClient({ adapter: new PrismaPg(createPool(liveUrl)) });
    return basePrisma.$extends({
        name: "retry-reads-on-conn-drop",
        query: {
            $allModels: {
                async $allOperations({ model, operation, args, query }) {
                    if (!READ_OPS.has(operation)) return query(args);

                    // Keep `replicaReady` current HERE, in the module that consumes it.
                    // See refreshReplicaReadinessInline() for why this cannot live
                    // somewhere tidier.
                    await refreshReplicaReadinessInline();

                    // ── Local-First Zero-Egress Reads ──────────────────────────────────────
                    // When local replica is ready and configured, serve reads locally with 0ms
                    // latency and 0 Supabase bandwidth/egress cost.
                    if (localClient && shouldReadLocal()) {
                        try {
                            const delegate = (localClient as unknown as Record<string, Record<string, (a: unknown) => Promise<unknown>>>)[model ?? ""];
                            if (delegate && typeof delegate[operation] === "function") {
                                return await delegate[operation](args);
                            }
                        } catch (localErr) {
                            console.warn("[prismaClient] local read error, falling back to live:", localErr);
                        }
                    }

                    let lastErr: unknown;
                    for (let attempt = 0; attempt < 3; attempt++) {
                        try {
                            const out = await query(args);
                            if (localClient) reportLiveUp();
                            return out;
                        } catch (e) {
                            lastErr = e;
                            if (!isTransientConnError(e)) throw e;
                            if (localClient) {
                                reportLiveDown();
                                try {
                                    const delegate = (localClient as unknown as Record<string, Record<string, (a: unknown) => Promise<unknown>>>)[model ?? ""];
                                    if (delegate && typeof delegate[operation] === "function") {
                                        return await delegate[operation](args);
                                    }
                                } catch (fallbackErr) {
                                    console.warn("[prismaClient] local fallback read failed:", fallbackErr);
                                }
                            }
                            await sleep(120 * (attempt + 1));
                        }
                    }
                    if (localClient) reportLiveDown();
                    throw lastErr;
                },
            },
        },
    }) as unknown as PrismaClient;
}

const MASTER_AND_BRANCH_MODELS = new Set([
    // Products & Inventory Masters
    "InvProduct",
    "InvProductVariant",
    "InvProductBranch",
    "InvProductPrice",
    "InvUnit",
    "InvBrand",
    "InvCategory",
    "InvSubCategory",
    "InvRack",
    "InvStockLedger",
    // Contacts & Customers
    "Person",
    "Company",
    "PersonCompany",
    "Address",
    // Accounts & Ledgers
    "Account",
    "AccountGroup",
    // POS & Shifts
    "PosShift",
    "PosShiftCashCount",
    "PosCounter",
    "PosService",
    // Universal Voucher Spine & Details
    "UniversalVoucher",
    "VoucherDetail",
    "VoucherInventoryLine",
    "VoucherGlLine",
    "VoucherLink",
    "VoucherSeries",
    "BooksConfig",
    // Loyalty & Retention
    "LoyaltyLedger",
    "LoyaltyConfig",
    "LoyaltyMilestone",
    "CouponRedemption",
    "GiftCardRedemption",
    // Tickets & CRM
    "Ticket",
    "TicketDetailRepair",
    "TicketDetailHelp",
    "TicketDetailDeal",
    "TicketDetailTask",
    "TicketLog",
    "AuditLog",
]);

/**
 * The replica client.
 * Serves local reads and allows safe offline master data creation/editing and branch-owned transactions.
 * Strictly blocks all deletions across all models while offline.
 */
function createLocal(): PrismaClient {
    const basePrisma = new PrismaClient({ adapter: new PrismaPg(createPool(localUrl)) });
    return basePrisma.$extends({
        name: "replica-is-read-only",
        query: {
            $allModels: {
                async $allOperations({ model, operation, args, query }) {
                    if (!READ_OPS.has(operation)) {
                        // 1. Strict Invariant: NO DELETIONS ALLOWED OFFLINE
                        if (operation === "delete" || operation === "deleteMany") {
                            throw new OfflineWriteBlockedError(
                                model ?? "unknown",
                                operation,
                                `Offline: deleting records from ${model} is disabled while offline to prevent data loss.`
                            );
                        }

                        // 2. Allow safe Master creation & editing, and branch-owned POS transactions
                        if (MASTER_AND_BRANCH_MODELS.has(model ?? "")) {
                            return query(args);
                        }
                        throw new OfflineWriteBlockedError(model ?? "unknown", operation);
                    }
                    return query(args);
                },
            },
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

/**
 * The replica client, or null on any machine without one.
 *
 * Exposed so readiness can be queried directly (see replicaReadiness.ts) without
 * going through the `prisma` Proxy, whose whole job is to decide which client to
 * use — asking IT would be circular.
 */
export function getLocalClient(): PrismaClient | null {
    return localClient;
}

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
