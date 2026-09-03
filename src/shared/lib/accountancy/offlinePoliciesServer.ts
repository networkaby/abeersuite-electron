/**
 * Server-side reader for the org's offline policies.
 *
 * The policy row is the ONLY source the enforcement path may trust. The browser copy
 * that used to live in localStorage was per-machine and invisible to the server, so
 * every server-side check silently fell back to `DEFAULT_OFFLINE_POLICIES` and the
 * admin's toggles changed nothing. One row, read here, decides for every counter.
 *
 * ── Why the caller passes the client ─────────────────────────────────────────
 * The main consumer is the replica write guard inside `createLocal()`. Reading
 * through the extended client from inside that extension would re-enter it, so the
 * guard hands us its own UNEXTENDED `basePrisma`. Routes hand us the ordinary
 * `prisma`. Either works — this module only ever reads one row.
 *
 * ── Why it is cached ─────────────────────────────────────────────────────────
 * The guard runs on EVERY write. A query per write would put a round trip in front
 * of every line of every bill, which on a counter is the one place latency is felt.
 * A short TTL is the right trade: a policy change is an admin action taken minutes
 * before it matters, never mid-transaction, so being up to a minute stale is
 * harmless — and on an offline counter the row cannot change at all, since the
 * counter may not write it and sync is what would bring a new one.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import {
    DEFAULT_OFFLINE_POLICIES,
    mergeOfflinePolicies,
    type OfflinePolicies,
} from "./offlineVoucherSafety";

/** How long a loaded row stays authoritative before the next read re-fetches it. */
const CACHE_TTL_MS = 60_000;

type Cache = { policies: OfflinePolicies; loadedAt: number };

/** Module state is per-process; the dev server reloads modules, so pin it globally. */
const globalForPolicies = globalThis as unknown as { __offlinePolicyCache?: Cache };

/**
 * The org's offline policies, cached for a minute.
 *
 * Fails OPEN to `DEFAULT_OFFLINE_POLICIES` — a missing row (nobody has visited the
 * settings page yet), an unreachable database, or a replica that has not synced the
 * table must not turn into "nothing may be written". The defaults are already the
 * conservative set: the risky voucher kinds are off in them.
 */
export async function loadOfflinePolicies(db: PrismaClient): Promise<OfflinePolicies> {
    const cached = globalForPolicies.__offlinePolicyCache;
    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.policies;

    let policies = DEFAULT_OFFLINE_POLICIES;
    try {
        const row = await db.offlinePolicy.findUnique({
            where: { id: 1 },
            select: { policies: true },
        });
        if (row) policies = mergeOfflinePolicies(row.policies);
    } catch {
        // Left as the defaults on purpose — see the fail-open note above.
    }

    globalForPolicies.__offlinePolicyCache = { policies, loadedAt: Date.now() };
    return policies;
}

/**
 * Drops the cached copy so the next read sees a just-saved row.
 *
 * Called by the settings PATCH. Only clears THIS process — another Next worker keeps
 * its copy for the rest of the TTL, which is the same minute of staleness the TTL
 * already allows and not worth a broadcast to shave.
 */
export function invalidateOfflinePolicyCache(): void {
    globalForPolicies.__offlinePolicyCache = undefined;
}
