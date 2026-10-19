import "server-only";
import { AI_KEY_FAILURE_REST_MS, AI_RATE_LIMIT_REST_MS } from "@/shared/lib/constants/ai";

/**
 * Which AI keys are resting, in memory (owner, 2026-10-19: no day lockout —
 * Gemini allows more calls per day than first thought, and most failures are
 * server load). A 429 (per-minute limit) rests the key for AI_RATE_LIMIT_REST_MS;
 * any other failure (refused, out of credit, 503, too slow) for
 * AI_KEY_FAILURE_REST_MS, then it is simply tried again. A restart forgets it all.
 * Holds .env key NAMES only — never a key value. Last-use times let callers take
 * free keys in turn.
 */

const restUntil: Record<string, number> = {};
const lastUsed: Record<string, number> = {};

/** Resting after a failure. */
export function isLockedOut(keyName: string): boolean {
    return (restUntil[keyName] ?? 0) > Date.now();
}

/** Mark a key as taken now (before the call, so parallel calls see it). */
export function noteKeyUse(keyName: string): void {
    lastUsed[keyName] = Date.now();
}

/** When the key was last taken (0 = not yet since start). */
export const keyLastUsed = (keyName: string) => lastUsed[keyName] ?? 0;

export function noteKeyFailure(keyName: string, opts: { rateLimited?: boolean } = {}): void {
    restUntil[keyName] = Date.now() + (opts.rateLimited ? AI_RATE_LIMIT_REST_MS : AI_KEY_FAILURE_REST_MS);
}

/** A success ends any rest early (a parallel call may have marked it). */
export function noteKeySuccess(keyName: string): void {
    delete restUntil[keyName];
}
