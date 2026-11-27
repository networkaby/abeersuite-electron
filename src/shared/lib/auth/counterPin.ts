/**
 * Which counter this server runs inside, and the PIN's shape.
 *
 * The PIN itself no longer lives in any database (owner, 2026-11-27): it is kept on
 * the counter PC by the desktop app (`electron/pinVault.ts`) and reopens a login the
 * person already made there with their password. `thisCounterId` stays here because
 * attendance, the shift and the counter takeover all ask it.
 */

import { readCounterSetup } from "@/shared/lib/counter/releaseGuard";
import { PIN_LENGTH } from "@/shared/lib/constants/session";

/**
 * Which counter is this server running inside — or null for "not a counter".
 *
 * Deliberately NOT taken from the request. The renderer knows this PC's device id, but
 * a value that arrives in a request body is a value an attacker chooses; this one is
 * put on the Next child by `electron/main.ts` and is the same source
 * `releaseGuard`/`writeRelay` already trust. Both halves must agree: the env var says
 * "a counter shell started me", the setup file says "and this is the counter it holds".
 */
export function thisCounterId(): number | null {
    if (!process.env.COUNTER_MACHINE_ID) return null;
    return readCounterSetup()?.counterId ?? null;
}

/** Four digits, any four — no "too easy" rules (owner, 2026-10-13). */
export function validatePin(pin: string): { ok: true } | { ok: false; reason: string } {
    return pin.length === PIN_LENGTH && /^\d+$/.test(pin)
        ? { ok: true }
        : { ok: false, reason: `A PIN is exactly ${PIN_LENGTH} digits.` };
}
