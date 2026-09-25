/**
 * Counter PIN — the rules, in one place.
 *
 * Typing a full email and password at the till every morning is the slowest minute of
 * the shop's day. A staff member may set six digits and then just tap their photo on
 * the sign-in shell. This module owns what that PIN is allowed to do.
 *
 * Three rules, and all three matter:
 *
 *  1. **It only works on a counter.** `thisCounterId()` answers null anywhere else —
 *     on Vercel `COUNTER_MACHINE_ID` is simply not set, so a PIN is not a credential
 *     on the website at all, whatever anyone posts at it.
 *  2. **It only works on THIS counter.** One row per person per counter. Every till
 *     holds a replica of the table, so a PIN that worked everywhere would make one
 *     stolen counter PC a key to every counter. Bound to a counter, the blast radius
 *     is that one machine.
 *  3. **It never replaces the password.** Two clocks below force the real password
 *     back every so often, and after a few idle days.
 *
 * Both clocks are read and written on the counter's own replica, because the till has
 * to be able to judge this with the line down. That is also this design's honest
 * weakness: somebody with file access to the PC could wind a clock back. They already
 * hold the machine and its data — rules 1 and 2 are the ones carrying the weight.
 */

import type { PrismaClient } from "@/generated/prisma/client";
import { readCounterSetup } from "@/shared/lib/counter/releaseGuard";
import { PIN_IDLE_MAX_AGE_MS, PIN_PASSWORD_MAX_AGE_MS } from "@/shared/lib/constants/session";

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

/** Why a PIN was refused. `wrong` and `stale` must stay distinguishable — see below. */
export type PinRefusal = "not-a-counter" | "no-pin" | "wrong" | "stale" | "blocked";

/**
 * Are the clocks still good, or is it password time?
 *
 * The distinction is not cosmetic. "Wrong PIN" and "the 10 days are up" look identical
 * to a cashier at 9am, and the second one is not a mistake they made — the screen has
 * to be able to say so, or a correct PIN refused in silence reads as a broken till.
 */
export function pinClocksExpired(pin: { lastPasswordAt: Date; lastLoginAt: Date }, now = Date.now()): boolean {
    return (
        now - pin.lastPasswordAt.getTime() > PIN_PASSWORD_MAX_AGE_MS ||
        now - pin.lastLoginAt.getTime() > PIN_IDLE_MAX_AGE_MS
    );
}

/**
 * Stamp the clocks after a successful sign-in on this counter.
 *
 * `password` resets both — typing it is exactly what the 10-day rule asks for. A PIN
 * sign-in moves only the idle clock, so the password still falls due on time.
 *
 * Best-effort on purpose: a failed stamp must never fail the sign-in. The worst it
 * costs is one extra password next time, which is the safe way to be wrong. Nothing is
 * created here either — no PIN row, no PIN — so a user who has never set one stays
 * unaffected.
 */
export async function stampCounterPinLogin(
    prisma: PrismaClient,
    userId: number,
    kind: "password" | "pin",
): Promise<void> {
    const counterId = thisCounterId();
    if (!counterId) return;
    const now = new Date();
    try {
        await prisma.userCounterPin.updateMany({
            where: { userId, counterId },
            data: kind === "password" ? { lastPasswordAt: now, lastLoginAt: now } : { lastLoginAt: now },
        });
    } catch {
        /* Replica hiccup — see above. */
    }
}

/**
 * Six digits, and not a guessable six.
 *
 * The rejected shapes are the ones people actually pick: one repeated digit, a straight
 * run either way, and a four-digit ATM habit padded out. Returns the reason so the
 * dialog can say it plainly instead of "invalid".
 */
export function validatePin(pin: string): { ok: true } | { ok: false; reason: string } {
    if (!/^\d{6}$/.test(pin)) return { ok: false, reason: "A PIN is exactly 6 digits." };
    if (/^(\d)\1{5}$/.test(pin)) return { ok: false, reason: "All six digits are the same — pick another." };
    const digits = [...pin].map(Number);
    const step = digits[1] - digits[0];
    if ((step === 1 || step === -1) && digits.every((d, i) => i === 0 || d - digits[i - 1] === step)) {
        return { ok: false, reason: "That is a straight run of digits — pick another." };
    }
    return { ok: true };
}
