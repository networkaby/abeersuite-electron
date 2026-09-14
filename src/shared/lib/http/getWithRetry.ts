import axios from "axios";

/**
 * GET with a few retries, for settings pages that must reflect the real saved
 * state rather than silently fall back to a default — which could otherwise be
 * saved over the owner's real config. Rethrows the last error once out of tries.
 *
 * Deliberately on plain axios, not the branch-aware `http` instance: these are
 * org-level config reads with no branch context to stamp.
 */
export async function getWithRetry<T>(url: string, tries = 3, delayMs = 400): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < tries; i++) {
        try {
            return (await axios.get<T>(url)).data;
        } catch (e) {
            lastErr = e;
            await new Promise((r) => setTimeout(r, delayMs));
        }
    }
    throw lastErr;
}
