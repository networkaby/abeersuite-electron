/**
 * The seam that lets a local write ask the outbox flusher to run soon.
 *
 * `flusher.ts` cannot be imported from `prismaClient.ts` directly: the flusher pulls in
 * `push.ts`, which imports `prismaLive` back out of `prismaClient.ts`. This module has
 * NO imports of its own, so both sides can depend on it without a cycle — the flusher
 * registers itself on start, the write path calls it, and on a machine where the flusher
 * never starts (Vercel, an ordinary laptop) the call is a no-op.
 *
 * Deliberately a HINT, exactly like the Realtime signal. A missed kick costs latency,
 * never a lost mutation: the row is already durably in `_outbox` — put there by a
 * Postgres trigger, not by app code — and the flusher's own interval will find it. That
 * is why it is safe for this to sit at the Prisma layer, which cannot see raw SQL.
 */

let kick: (() => void) | null = null;

/** Called once by `startOutboxFlusher`. */
export function setOutboxKick(fn: () => void): void {
    kick = fn;
}

/** Called after a successful local write. Silent when no flusher is running. */
export function kickOutboxFlush(): void {
    kick?.();
}
