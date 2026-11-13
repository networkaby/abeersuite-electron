// ── Login rate-limit ──────────────────────────────────────────────────────────
// Sliding-window brute-force throttle for the credential authorizers (staff +
// portal), OTP codes and the counter PIN. Keyed by the normalized login
// identifier: after MAX_FAILURES failed attempts inside WINDOW_MS, further
// attempts for that identifier are rejected until the window slides past the
// oldest failure. A successful login clears the counter.
//
// Where the count lives:
//   - Cloud (Vercel): the LoginFailure table. Many server copies run at once and
//     each restarts often, so an in-memory count let an attacker spread guesses
//     over copies and slip past the limit (security review 2026-11-13).
//   - Counter PC: in memory. One long-lived process, so memory already holds,
//     and the till never pushes this table (sync/neverPush.ts).
//   - Database unreachable: falls back to memory for that call — still a limit,
//     never a lock-out of everyone.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { IS_COUNTER_PC } from "@/shared/lib/prisma/counterMode";

const WINDOW_MS    = 15 * 60 * 1000; // 15 minutes
const MAX_FAILURES = 5;
const MAX_KEYS     = 10_000;         // memory cap — oldest keys evicted first

const normalize = (identifier: string) => identifier.trim().toLowerCase();
const windowStart = () => new Date(Date.now() - WINDOW_MS);

// ── Memory store (counter PC, and fallback) ───────────────────────────────────

const failures = new Map<string, number[]>();

function prune(key: string, now: number): number[] {
    const list = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    if (list.length === 0) failures.delete(key);
    else failures.set(key, list);
    return list;
}

function memoryCount(key: string): number {
    return prune(key, Date.now()).length;
}

function memoryRecord(key: string): void {
    const now = Date.now();
    const list = prune(key, now);
    list.push(now);
    failures.set(key, list);
    // Hard memory cap: drop the oldest entry (Map preserves insertion order).
    if (failures.size > MAX_KEYS) {
        const oldest = failures.keys().next().value;
        if (oldest !== undefined) failures.delete(oldest);
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

async function failureCount(key: string): Promise<number> {
    if (IS_COUNTER_PC) return memoryCount(key);
    try {
        return await prisma.loginFailure.count({ where: { key, createdAt: { gte: windowStart() } } });
    } catch (err) {
        console.warn("[loginRateLimit] DB count failed, using memory:", err);
        return memoryCount(key);
    }
}

/**
 * True when this identifier has exhausted its failed-attempt budget.
 *
 * `maxFailures` tightens the budget for a weaker secret — the counter PIN passes 3,
 * since six digits are guessable in a way a password is not. Callers that pass a
 * prefixed key ("pin:someone@shop") get their own counter, so a fumbled PIN can never
 * lock somebody out of the password they still need.
 */
export async function isLoginBlocked(identifier: string, maxFailures = MAX_FAILURES): Promise<boolean> {
    return (await loginTriesLeft(identifier, maxFailures)) <= 0;
}

/** Failed attempts this identifier may still make inside the window. */
export async function loginTriesLeft(identifier: string, maxFailures = MAX_FAILURES): Promise<number> {
    const key = normalize(identifier);
    if (!key) return maxFailures;
    return Math.max(0, maxFailures - (await failureCount(key)));
}

/** Record one failed attempt for this identifier. */
export async function recordLoginFailure(identifier: string): Promise<void> {
    const key = normalize(identifier);
    if (!key) return;
    if (IS_COUNTER_PC) return memoryRecord(key);
    try {
        // Prune this key's expired rows in the same trip, and now and then the
        // whole table, so it never grows past the last 15 minutes of failures.
        await prisma.$transaction([
            prisma.loginFailure.create({ data: { key } }),
            prisma.loginFailure.deleteMany({
                where: Math.random() < 0.02 ? { createdAt: { lt: windowStart() } } : { key, createdAt: { lt: windowStart() } },
            }),
        ]);
    } catch (err) {
        console.warn("[loginRateLimit] DB record failed, using memory:", err);
        memoryRecord(key);
    }
}

/** Clear the counter after a successful login. */
export async function clearLoginFailures(identifier: string): Promise<void> {
    const key = normalize(identifier);
    if (!key) return;
    failures.delete(key);
    if (IS_COUNTER_PC) return;
    await prisma.loginFailure.deleteMany({ where: { key } }).catch((err) => {
        console.warn("[loginRateLimit] DB clear failed:", err);
    });
}
