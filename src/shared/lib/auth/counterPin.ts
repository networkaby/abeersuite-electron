/**
 * Counter PIN — the rules, in one place.
 *
 * Four digits, any four, and they do two jobs on a counter (owner, 2026-10-15: "don't
 * ask for password, respect the 4-digit PIN even on a fresh boot … password only after
 * x idle days or y days"):
 *   • lift the counter's LOCK (`CounterLock.tsx`, `/api/counter-lock`) — the login and
 *     the open work under it stay as they were;
 *   • SIGN IN on this counter (`authorizeStaffPin`) — a tapped photograph and four
 *     digits, after a restart, a full sign-out, or when a colleague takes the till.
 *
 *  1. **It only works on a counter.** `thisCounterId()` answers null anywhere else —
 *     on Vercel `COUNTER_MACHINE_ID` is simply not set.
 *  2. **It only works on THIS counter.** One row per person per counter. Every till
 *     holds a replica of the table, so a PIN that worked everywhere would make one
 *     stolen counter PC a key to every counter.
 *  3. **It never replaces the password.** Two clocks on the row, the same two that end
 *     a login (`constants/session.ts`): 10 days since the password was typed on this
 *     counter, 3 days with nobody using it here. Past either, the password.
 *
 * The clocks are stamped by the till on its own replica (`localAuthority` in the sync
 * registry), so it can judge them with the line down. Somebody with file access to the
 * PC could wind one back — they already hold the machine; rules 1 and 2 carry the weight.
 */

import type { PrismaClient } from "@/generated/prisma/client";
import { readCounterSetup } from "@/shared/lib/counter/releaseGuard";
import { LOGIN_IDLE_MAX_AGE_MS, LOGIN_MAX_AGE_MS, PIN_LENGTH } from "@/shared/lib/constants/session";

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

/**
 * Are the clocks still good, or is it password time?
 *
 * Kept apart from "wrong PIN" on purpose: the two look identical to a cashier at 9am,
 * and the second is not a mistake they made — the screen has to be able to say so.
 */
export function pinClocksExpired(pin: { lastPasswordAt: Date; lastLoginAt: Date }, now = Date.now()): boolean {
    return (
        now - pin.lastPasswordAt.getTime() > LOGIN_MAX_AGE_MS ||
        now - pin.lastLoginAt.getTime() > LOGIN_IDLE_MAX_AGE_MS
    );
}

/**
 * Stamp this person's clocks on this counter.
 *
 *   • `password` — both go back to zero; typing it is what the 10-day rule asks for.
 *   • `used`     — only the idle clock moves (a PIN sign-in, an unlock, a lock at the
 *                  last real input), so the password still falls due on time.
 *   • `expire`   — the password is due now: too many wrong PINs in a row.
 *
 * Best-effort: a failed stamp never fails a sign-in — the worst it costs is one extra
 * password. Nothing is created: somebody with no PIN here stays unaffected.
 */
export async function stampCounterPin(
    prisma: PrismaClient,
    userId: number,
    kind: "password" | "used" | "expire",
    at = new Date(),
): Promise<void> {
    const counterId = thisCounterId();
    if (!counterId || !Number.isFinite(userId) || userId <= 0) return;
    const data = kind === "password" ? { lastPasswordAt: at, lastLoginAt: at }
        : kind === "used" ? { lastLoginAt: at }
        : { lastPasswordAt: new Date(0) };
    try {
        await prisma.userCounterPin.updateMany({ where: { userId, counterId }, data });
    } catch {
        /* replica hiccup — see above */
    }
}
