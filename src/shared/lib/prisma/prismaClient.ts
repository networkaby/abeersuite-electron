import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { OfflineWriteBlockedError } from "./offlineError";
import { dbTargets, isDualDb, type DbId } from "@/shared/lib/db/dbTargets";
import { currentPrimary, invalidatePrimary } from "@/shared/lib/db/dbPrimary";
import { noteDeleted } from "@/shared/lib/realtime/deleteAnnounce";
import { isConnectionFailure } from "@/shared/lib/sync/connectionError";
import {
    getMode,
    maybeReprobe,
    readyIsStale,
    registerLiveProbe,
    reportLiveDown,
    reportLiveUp,
    setReplicaReady,
    isReplicaReady,
    shouldReadLocal,
    shouldWriteLocal,
    localWriteIsFallback,
    READ_PREFERENCE,
    maybeHeartbeatLive,
    IS_COUNTER_PC,
} from "./counterMode";
import { isVoucherTypeSafeOffline, getOfflineVoucherBlockedReason } from "@/shared/lib/accountancy/offlineVoucherSafety";
import { loadOfflinePolicies } from "@/shared/lib/accountancy/offlinePoliciesServer";
import { checkOfflinePolicyForWrite } from "@/shared/lib/accountancy/offlinePolicyTargets";

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

// DB1 / DB2 (dbTargets.ts). Without DATABASE_URL_2 this is just DB1 = DATABASE_URL(_1), one client,
// and the exports below are the plain clients — no Proxy, exactly as before.
const liveUrls: Partial<Record<DbId, string | undefined>> = Object.fromEntries(
    dbTargets().map((t) => [t.id, normalize(t.pooled)]),
);
if (!liveUrls.DB1) liveUrls.DB1 = normalize(process.env.DATABASE_URL);
const DUAL = isDualDb();
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
        const rows = await localClient.$queryRaw<{ ready: boolean; schema_ok: boolean }[]>`
            SELECT ready, schema_ok FROM "_sync_status" WHERE only_row
        `;
        setReplicaReady(
            rows.length > 0 && rows[0].ready === true,
            rows.length === 0 || rows[0].schema_ok !== false,
        );
    } catch {
        setReplicaReady(false);
    }
}

// In dev, Next.js HMR re-evaluates this module on every edit. Without a cache, each
// reload builds a fresh pg Pool (max 10) that is never closed, so open connections
// pile up across reloads until the database refuses new ones ("timeout exceeded when
// trying to connect"). Cache the client on globalThis so every reload reuses one pool.
// Production containers are short-lived and single-instance, so no caching there.
const globalForPrisma = globalThis as unknown as {
    __prismaBases?: Partial<Record<DbId, PrismaClient>>;
    __prismaLocal?: PrismaClient;
};

/**
 * ONE physical connection to Supabase, wrapped twice below.
 *
 * `$extends` shares the underlying engine and pool, so the second wrapper costs no
 * extra connections — it only changes which reads may be answered from the replica.
 */
const baseLives: Partial<Record<DbId, PrismaClient>> = globalForPrisma.__prismaBases ?? {};
for (const id of Object.keys(liveUrls) as DbId[]) {
    baseLives[id] ??= new PrismaClient({ adapter: new PrismaPg(createPool(liveUrls[id])) });
}

/** The primary's base client (DB1 in single-database mode). */
function baseLive(): PrismaClient {
    return (DUAL ? baseLives[currentPrimary()] : undefined) ?? baseLives.DB1!;
}

/**
 * One wrapper per database, chosen per property access. A whole `$transaction` stays on
 * the client it started on, because the method is read once from one client.
 */
function byPrimary(clients: Partial<Record<DbId, PrismaClient>>): PrismaClient {
    if (!DUAL) return clients.DB1!;
    const pick = () => clients[currentPrimary()] ?? clients.DB1!;
    return new Proxy({} as PrismaClient, {
        get: (_t, prop) => Reflect.get(pick(), prop),
        has: (_t, prop) => Reflect.has(pick(), prop),
    });
}

/** Postgres "read-only transaction": this server wrote to staging on a stale pointer. */
function noteReadOnly(e: unknown): void {
    if (DUAL && (e as { code?: string } | null)?.code === "25006") invalidatePrimary();
}

/**
 * @param allowLocalRedirect
 *   true  — reads may be served from the replica when it is ready (the egress saving).
 *   false — every read goes to Supabase. For reads whose result AUTHORISES or REFLECTS
 *           a write.
 *
 * ── Why "reflects" belongs in that rule, not just "authorises" ────────────────
 * The replica lags live by up to a sync cycle, and on a page that just wrote, a stale
 * answer does not read as "slightly old data" — it reads as "the write did not
 * happen". Releasing a counter's device lock wrote to live and then re-read the
 * replica, which still showed it locked: a release that had genuinely succeeded
 * looked broken, and the counter stayed unusable.
 */
/**
 * How far a read on the live client may be redirected to the replica.
 *
 *   "preference" — whenever `shouldReadLocal()` says so. The egress win.
 *   "outage"     — only while Supabase is unreachable, where a stale answer beats a
 *                  dead page and there is no authoritative source left to consult.
 *   "never"      — Supabase or an error. For the push path, which is meaningless
 *                  against the replica: it is the thing sending rows TO Supabase.
 */
type ReadRedirect = "preference" | "outage" | "never";

function wrapLive(redirect: ReadRedirect): Partial<Record<DbId, PrismaClient>> {
    return Object.fromEntries(
        (Object.keys(baseLives) as DbId[]).map((id) => [id, wrapOne(redirect, baseLives[id]!)]),
    );
}

function wrapOne(redirect: ReadRedirect, base: PrismaClient): PrismaClient {
    return base.$extends({
        name: `live-reads-${redirect}`,
        query: {
            $allModels: {
                async $allOperations({ model, operation, args, query }) {
                    // ── Writes ───────────────────────────────────────────────────
                    // Still never retried: a write that died after reaching the server
                    // but before the ack could otherwise be applied twice. But its
                    // outcome does tell us whether live is reachable, and while reads
                    // are served locally a write is often the ONLY thing touching live
                    // at all — without this, nothing could ever demote us.
                    if (!READ_OPS.has(operation)) {
                        try {
                            const out = await query(args);
                            if (localClient) reportLiveUp();
                            // A hard delete is invisible to every counter's watermark pull;
                            // say which table lost rows so their workers reconcile it now
                            // instead of within the hour. See deleteAnnounce.ts.
                            if (operation === "delete") noteDeleted(model);
                            else if (operation === "deleteMany" && (out as { count?: number } | null)?.count) noteDeleted(model);
                            return out;
                        } catch (e) {
                            noteReadOnly(e);
                            if (localClient && isConnectionFailure(e)) reportLiveDown();
                            throw e;
                        }
                    }

                    // Keep `replicaReady` current HERE, in the module that consumes it.
                    // See refreshReplicaReadinessInline() for why this cannot live
                    // somewhere tidier.
                    await refreshReplicaReadinessInline();

                    // ── Local-First Zero-Egress Reads ──────────────────────────────────────
                    // When the replica is ready and configured, serve reads locally with 0ms
                    // latency and no Supabase egress.
                    //
                    // "outage" still honours the outage case even though it skips the
                    // preference: when live is genuinely unreachable there is no
                    // authoritative source left to consult, and refusing outright would
                    // take offline shift-open — and every other offline-capable flow —
                    // down with it. "never" refuses even that, because the only caller is
                    // the push path, whose entire job is to reach Supabase.
                    const serveLocal =
                        redirect === "never" ? false
                            : redirect === "preference" ? shouldReadLocal()
                                : getMode() === "LOCAL";
                    if (localClient && serveLocal) {
                        // Nothing else in this mode touches live, so this heartbeat is the
                        // only thing that can notice an outage. Fire-and-forget — it never
                        // delays the read below.
                        maybeHeartbeatLive();
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
                            if (!isConnectionFailure(e)) throw e;
                            if (localClient) {
                                reportLiveDown();
                                // Same reasoning as the outage case above: live having just
                                // failed means there is no authoritative answer to be had, so
                                // a stale one beats a dead page — for every redirect policy
                                // except "never", where a replica answer would be worse than
                                // the error (the caller is trying to reach Supabase itself).
                                if (redirect === "never") throw e;
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


// ── Id-range confirmation cache ──────────────────────────────────────────────
// 79 models mint their own primary key locally (autoincrement sequences) —
// writing one before _apply_id_range() has actually restarted those sequences on
// THIS machine risks the exact cross-counter/cloud id collision the whole scheme
// exists to prevent, and does it silently: the push upserts by id, so a colliding
// row overwrites an unrelated cloud record. `_id_ranges` is the bookkeeping table
// that function writes on success; read it as the single source of truth rather
// than trusting the shift-open response.
//
// This gates EVERY local write, not just the sequence-backed models. Once local is
// a normal place to write rather than an emergency, a confirmed range is a
// precondition for the counter functioning at all — and a per-model exemption list
// is precisely the kind of hand-kept thing that drifted before.
//
// Cached briefly — checked on every local write, and the table only ever changes
// at shift-open/setup.
const ID_RANGE_CACHE_TTL_MS = 30_000;
let idRangeAppliedCache: { value: boolean; checkedAt: number } | null = null;

async function isOfflineRangeApplied(basePrisma: PrismaClient): Promise<boolean> {
    const now = Date.now();
    if (idRangeAppliedCache && now - idRangeAppliedCache.checkedAt < ID_RANGE_CACHE_TTL_MS) {
        return idRangeAppliedCache.value;
    }
    let applied = false;
    try {
        const rows = await basePrisma.$queryRawUnsafe<Array<{ block_start: number }>>(
            `SELECT block_start FROM "_id_ranges" WHERE only_row LIMIT 1`,
        );
        applied = rows.length > 0 && Number.isInteger(rows[0]?.block_start);
    } catch {
        // Table missing, connection blip, or not yet provisioned — safe default is
        // "not applied", never assume protection that hasn't been confirmed.
        applied = false;
    }
    idRangeAppliedCache = { value: applied, checkedAt: now };
    return applied;
}

/**
 * The replica client.
 *
 * Two guards, and deliberately no more. What used to be here — an allowlist of 36
 * writable models, a 14-model outbox map, and a block on raw execution — is gone:
 *
 *   - The **allowlist** was the direct cause of two silent data faults. Three models
 *     had outbox entries but were missing from it, so their writes threw; 27 models
 *     were in it with no outbox entry, so their writes succeeded locally and never
 *     reached the cloud — products, customers, accounts, stock ledger, loyalty
 *     ledger. A list of "models the counter may write" is a list of features it has,
 *     which is what `requireAuth` and the permission system already decide.
 *   - The **outbox enqueue** now happens in a Postgres trigger (see
 *     `_outbox_capture` in scripts/gen-local-schema.ts). It records the committed
 *     row rather than `args.data`, and it cannot be bypassed by `createMany`,
 *     `upsert`, a nested write or raw SQL — all of which slipped past the version
 *     that lived here.
 *   - The **raw-execution block** existed to keep the replica a pristine mirror.
 *     It is not one any more; it is where this machine's work is written first. The
 *     trigger captures raw writes like any other, and the `smx_app` role still has
 *     no DDL and no DELETE, so raw SQL cannot do the two irreversible things.
 */
function createLocal(): PrismaClient {
    const basePrisma = new PrismaClient({ adapter: new PrismaPg(createPool(localUrl)) });
    return basePrisma.$extends({
        name: "replica-write-guard",
        query: {
            $allModels: {
                async $allOperations({ model, operation, args, query }) {
                    if (!READ_OPS.has(operation)) {
                        // 1. No deletes, ever. A delete replayed against a row another
                        // counter has since changed is not recoverable, and the reconcile
                        // pass cannot tell a local delete from a row it never received.
                        // Enforced twice: here for a message a cashier can act on, and in
                        // the `smx_app` grant, which is what survives raw SQL, a cascade,
                        // or a future refactor of this extension.
                        if (operation === "delete" || operation === "deleteMany") {
                            throw new OfflineWriteBlockedError(
                                model ?? "unknown",
                                operation,
                                `Deleting ${model} records is not possible on a counter — do it from an office machine.`,
                            );
                        }

                        // 2. Nothing may be written until this counter's id range is
                        // confirmed applied. See the note on isOfflineRangeApplied: this
                        // covers every model, because an unreserved sequence mints ids
                        // from 1 and the push then overwrites an unrelated cloud row.
                        if (!(await isOfflineRangeApplied(basePrisma))) {
                            throw new OfflineWriteBlockedError(
                                model ?? "unknown",
                                operation,
                                "This counter's reserved id range is not confirmed applied yet — nothing can be written locally until it is. Re-open the shift, or re-run counter setup.",
                            );
                        }

                        // 3. Offline policy — only when a local write means "Supabase is
                        // unreachable" (WRITE_MODE=live). Those kinds were held back
                        // because they need live validation and the outage is temporary.
                        // Under WRITE_MODE=local the replica is simply where writes go:
                        // the counter is the web app, gated by roles alone, so enforcing
                        // this would refuse those kinds permanently and break the
                        // counter rather than protect anything.
                        //
                        // The policies come from the DB (cached), not from the browser's
                        // localStorage as they once did: a per-browser copy the server
                        // could not see meant every check here silently used the built-in
                        // defaults, so the settings page changed nothing.
                        if (localWriteIsFallback()) {
                            // The policy row itself is never written while cut off. It
                            // is the org's decision about what THIS machine may do
                            // during an outage; letting the cut-off machine edit it
                            // would let a counter lift its own restraints with nobody
                            // able to see it until the damage was already synced up.
                            if (model === "OfflinePolicy") {
                                throw new OfflineWriteBlockedError(
                                    model,
                                    operation,
                                    "Offline policies cannot be changed while this counter is cut off from Supabase.",
                                );
                            }

                            const policies = await loadOfflinePolicies(basePrisma);

                            if (model === "UniversalVoucher") {
                                const data = (args as { data?: { type?: string } })?.data;
                                if (data?.type && !isVoucherTypeSafeOffline(data.type, policies)) {
                                    throw new OfflineWriteBlockedError(
                                        model,
                                        operation,
                                        getOfflineVoucherBlockedReason(data.type),
                                    );
                                }
                            } else if (model) {
                                // Master data + ticket intake. Returns null for the
                                // overwhelming majority of models, which are not gated.
                                const refusal = await checkOfflinePolicyForWrite(
                                    basePrisma, model, operation, args, policies,
                                );
                                if (refusal) throw new OfflineWriteBlockedError(model, operation, refusal);
                            }
                        }

                        // The row is captured by a Postgres trigger, and the same trigger
                        // wakes the flusher with NOTIFY at commit (see flusher.ts). Nothing
                        // to do here: the database announces the write itself, so raw SQL
                        // and Prisma writes are treated identically.
                        return query(args);
                    }

                    // ── Reads, when the operator wants them live — or the replica
                    // cannot answer ──────────────────────────────────────────────
                    // The mirror image of the redirect in wrapLive: WRITE_MODE=local
                    // with READ_MODE=live means writes land here but reads should see
                    // Supabase. Only while Supabase is actually reachable — during an
                    // outage the replica is the only answer there is.
                    //
                    // The same redirect applies while the replica is NOT READY, whatever
                    // READ_MODE says. A replica that has never synced (a PC with no
                    // counter — its worker does not run, and its data is wiped) returns
                    // no rows without error: the login's `user.findUnique` came back
                    // empty and read as a wrong password, on a PC whose only way to
                    // become a counter is to sign in. wrapLive fails closed on readiness;
                    // this path did not, and old leftover data was hiding that.
                    //
                    // Reads inside a transaction are NOT redirected: `query(args)` for a
                    // transactional operation must stay on the client that opened it, and
                    // the Proxy has already chosen this one for the write.
                    await refreshReplicaReadinessInline();
                    if ((READ_PREFERENCE === "live" || !isReplicaReady()) && getMode() === "LIVE") {
                        try {
                            const delegate = (baseLive() as unknown as Record<string, Record<string, (a: unknown) => Promise<unknown>>>)[model ?? ""];
                            if (delegate && typeof delegate[operation] === "function") {
                                const out = await delegate[operation](args);
                                reportLiveUp();
                                return out;
                            }
                        } catch (e) {
                            if (isConnectionFailure(e)) reportLiveDown();
                            console.warn("[prismaClient] live read failed, using the replica:", e);
                        }
                    }
                    return query(args);
                },
            },
        },
    }) as unknown as PrismaClient;
}

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

/**
 * Supabase, and only Supabase.
 *
 * Its reads are never redirected, not even during an outage — the sole caller is the
 * push path, whose whole job is to reach Supabase, and an answer from the replica
 * would be worse than the error.
 *
 * The name used to mean something weaker: it was the ordinary live client, whose reads
 * DID redirect to the replica. Nothing relied on that, so it now says what it does.
 */
export const prismaLive: PrismaClient = byPrimary(wrapLive("never"));

/**
 * Supabase whenever Supabase is reachable — never the replica merely because
 * `READ_MODE` prefers it.
 *
 * Kept for the counter-administration flows only — binding a PC to a counter, and the
 * config PATCH behind /office/admin/counters. Those are technician actions performed
 * online, and each read gates a decision to REFUSE: a stale "still bound" or "shift
 * still open" answer blocks something that is in fact allowed, and nobody standing at
 * the counter can tell that apart from a real conflict.
 *
 * Everything else that used this — the counter list, shift-open's own reads — now uses
 * `prisma`, and follows the dials like the rest of the app.
 *
 * Not a hard guarantee: during a real outage it falls back to the replica like
 * everything else, because a counter must keep working offline and a stale answer
 * then beats no answer. What it removes is the SILENT staleness while perfectly
 * online, which is the case that reads as a bug.
 */
const prismaOnline: PrismaClient = byPrimary(wrapLive("outage"));

/** Reads that redirect to the replica whenever `READ_MODE` says they may. */
const prismaReadRouted: PrismaClient = byPrimary(wrapLive("preference"));

/** The counter's replica, or null everywhere else. */
const localClient: PrismaClient | null = localUrl
    ? (globalForPrisma.__prismaLocal ?? createLocal())
    : null;

if (process.env.NODE_ENV !== "production") {
    globalForPrisma.__prismaBases = baseLives;
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
 * ── WRITE_MODE picks the client; READ_MODE redirects reads off it ────────────
 * Because the choice is per-CLIENT and not per-operation, it has to be made on the
 * thing that cannot be split: a `$transaction` is a write, so it opens on the
 * WRITE_MODE client and every read inside it stays on that same database. Deciding
 * per-operation instead would let one transaction straddle two databases.
 *
 * Reads then get redirected by the extension inside whichever client was chosen —
 * `wrapLive("preference")` sends them to the replica, `createLocal()` sends them to
 * Supabase — so the two dials compose without either overriding the other:
 *
 *   WRITE_MODE=local, READ_MODE=local  -> replica for both. The rollout target.
 *   WRITE_MODE=live,  READ_MODE=live   -> Supabase for both. The escape hatch.
 *   WRITE_MODE=live,  READ_MODE=local  -> Supabase writes, replica reads.
 *   WRITE_MODE=local, READ_MODE=live   -> replica writes, Supabase reads.
 *
 * Under WRITE_MODE=live an outage still demotes to the replica, where the write is
 * captured by the outbox trigger and pushed when Supabase returns.
 */
export const prisma: PrismaClient = localClient
    ? new Proxy({} as PrismaClient, {
        get(_target, prop, receiver) {
            maybeReprobe();
            const client = shouldWriteLocal() ? localClient : prismaReadRouted;
            return Reflect.get(client, prop, receiver);
        },
        has(_target, prop) {
            return Reflect.has(shouldWriteLocal() ? localClient : prismaReadRouted, prop);
        },
    })
    : prismaLive;

/**
 * Supabase whenever it is reachable, for the two technician flows that need it.
 *
 * Exported separately from `prisma` because on a counter `prisma` may be the replica,
 * and these two reads decide whether to REFUSE an action — a stale "still bound"
 * answer turns a counter an admin released minutes ago into one nobody can set up.
 */
export const prismaAuthoritative: PrismaClient = localClient ? prismaOnline : prismaLive;

