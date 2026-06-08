import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL?.replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");

// Local Postgres (localhost) speaks plaintext — forcing SSL there fails the
// handshake. Supabase/remote needs SSL. Detect by host so dev-on-localhost and
// prod-on-Supabase both work from the same client.
const isLocalDb = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString ?? "");

// On Vercel serverless: prefer the Supabase pooler URL (port 6543, pgbouncer transaction mode)
// in DATABASE_URL. With pooler, max can stay modest per container. Without pooler, raising max
// risks exhausting Postgres' direct-connection limit under concurrent invocations.
const pool = new Pool({
    connectionString,
    ssl: isLocalDb ? false : { rejectUnauthorized: false },
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

const basePrisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// ── Connection-drop resilience ──────────────────────────────────────────────
// Even with keepAlive, a connection can be killed in the gap between checkouts, so
// the FIRST query on it fails with a transient "Connection terminated" error. We
// retry — but ONLY read operations, which are idempotent and can never double-write.
// Writes and transactions are deliberately NOT auto-retried (a write that died after
// reaching the server but before the ack could otherwise be applied twice).
const READ_OPS = new Set([
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
export const prisma: PrismaClient = basePrisma.$extends({
    name: "retry-reads-on-conn-drop",
    query: {
        $allModels: {
            async $allOperations({ operation, args, query }) {
                if (!READ_OPS.has(operation)) return query(args);
                let lastErr: unknown;
                for (let attempt = 0; attempt < 3; attempt++) {
                    try {
                        return await query(args);
                    } catch (e) {
                        lastErr = e;
                        if (!isTransientConnError(e)) throw e;
                        await sleep(120 * (attempt + 1));
                    }
                }
                throw lastErr;
            },
        },
    },
}) as unknown as PrismaClient;
