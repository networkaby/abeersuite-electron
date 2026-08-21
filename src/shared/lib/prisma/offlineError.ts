/**
 * The counter PC serves reads from a local Postgres replica (see prismaClient.ts).
 * The replica is a MIRROR, never a destination: anything that would write to it is
 * refused rather than applied, because a write that landed only on the counter would
 * be invisible to Supabase — the convergence point — and silently lost on reseed.
 *
 * A refusal travels as this error so the whole stack can recognise it:
 *   route  → handleApiError() turns it into 503 { error: OFFLINE_READ_ONLY }
 *   client → the axios interceptor toasts it instead of showing a generic failure
 *
 * NOT a bug signal. Being offline is an expected state at a shop counter, so this
 * must never reach Sentry as an unhandled 500 — that would bury real faults under
 * a daily tide of "the internet blinked".
 */

/** Wire code shared by the server (response body) and the client (interceptor). */
export const OFFLINE_READ_ONLY = "offline_read_only";

/** Thrown when a write is attempted while reads are being served from the replica. */
export class OfflineWriteBlockedError extends Error {
    readonly code = OFFLINE_READ_ONLY;
    /** Prisma model the write targeted, when known — "$executeRaw" for raw writes. */
    readonly model: string;
    /** Prisma operation (`create`, `updateMany`, …) that was refused. */
    readonly operation: string;

    constructor(model: string, operation: string) {
        super(`Offline: refused ${operation} on ${model} — the counter replica is read-only.`);
        this.name = "OfflineWriteBlockedError";
        this.model = model;
        this.operation = operation;
    }
}

/** Type guard — survives the structured-clone boundary that `instanceof` does not. */
export function isOfflineWriteBlocked(e: unknown): e is OfflineWriteBlockedError {
    return e instanceof OfflineWriteBlockedError
        || (typeof e === "object" && e !== null && (e as { code?: unknown }).code === OFFLINE_READ_ONLY);
}
