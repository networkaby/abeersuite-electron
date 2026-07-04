// ── Login rate-limit ──────────────────────────────────────────────────────────
// Sliding-window brute-force throttle for the credential authorizers (staff +
// portal). Keyed by the normalized login identifier: after MAX_FAILURES failed
// attempts inside WINDOW_MS, further attempts for that identifier are rejected
// until the window slides past the oldest failure. A successful login clears
// the counter.
//
// In-memory by design (no schema change): on Vercel Fluid Compute the instance
// is reused across requests, so the counter holds within an instance. Multiple
// instances each keep their own counter — an attacker gets at most
// MAX_FAILURES × instances, which still kills online brute force. If we ever
// need a hard global cap, move the counter to a DB/Redis row — same interface.

const WINDOW_MS    = 15 * 60 * 1000; // 15 minutes
const MAX_FAILURES = 5;
const MAX_KEYS     = 10_000;         // memory cap — oldest keys evicted first

const failures = new Map<string, number[]>();

function prune(key: string, now: number): number[] {
    const list = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    if (list.length === 0) failures.delete(key);
    else failures.set(key, list);
    return list;
}

/** True when this identifier has exhausted its failed-attempt budget. */
export function isLoginBlocked(identifier: string): boolean {
    const key = identifier.trim().toLowerCase();
    if (!key) return false;
    return prune(key, Date.now()).length >= MAX_FAILURES;
}

/** Record one failed attempt for this identifier. */
export function recordLoginFailure(identifier: string): void {
    const key = identifier.trim().toLowerCase();
    if (!key) return;
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

/** Clear the counter after a successful login. */
export function clearLoginFailures(identifier: string): void {
    failures.delete(identifier.trim().toLowerCase());
}
