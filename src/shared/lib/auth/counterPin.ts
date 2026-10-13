/**
 * Counter PIN — the rules, in one place.
 *
 * The PIN only LIFTS A COUNTER'S LOCK (`CounterLock.tsx`, `/api/counter-lock`). It
 * never signs anyone in — that is always the password (owner, 2026-10-13: "pin is
 * for only unlock"). Four digits, any four.
 *
 *  1. **It only works on a counter.** `thisCounterId()` answers null anywhere else —
 *     on Vercel `COUNTER_MACHINE_ID` is simply not set.
 *  2. **It only works on THIS counter.** One row per person per counter. Every till
 *     holds a replica of the table, so a PIN that worked everywhere would make one
 *     stolen counter PC a key to every counter.
 *  3. **It only ever reopens a login the password already opened.** The login's own
 *     clocks (10 days since the password, 3 idle days — `constants/session.ts`) end
 *     it whatever the PIN says.
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
