/**
 * Does this person have a usable PIN on this counter, right now?
 *
 * Asked by the sign-in shell before it puts a keypad up, and again when a PIN is
 * refused, so the screen can say WHICH refusal it was. That distinction is the whole
 * reason this route exists: "wrong PIN" and "the ten days are up" look identical to a
 * cashier at nine in the morning, and the second one is not a mistake they made. A
 * correct PIN refused in silence reads as a broken till.
 *
 * Unauthenticated by necessity — nobody is signed in yet — and therefore deliberately
 * narrow:
 *   • it answers only inside a counter shell (`thisCounterId`), so it does not exist
 *     on the web deployment at all;
 *   • it answers only about the counter the asking PC holds;
 *   • it says whether a PIN is usable, never anything about the person, and never
 *     whether the account exists — an unknown email and one with no PIN on this
 *     counter give the same "none".
 *
 * Read against the ordinary client, which on a counter is the replica: the shell must
 * be able to draw its keypad with the line down.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { isLoginBlocked, recordLoginFailure } from "@/shared/lib/auth/loginRateLimit";
import { pinClocksExpired, thisCounterId } from "@/shared/lib/auth/counterPin";
import { staffHasLeft } from "@/shared/lib/hr/staffStatus";

const schema = z.object({ email: z.string().email() });

/** `left` — HR marked this person as left; no sign-in of any kind, and the shell
 *  drops the face card. The one answer that says something about the person,
 *  and deliberately so: a card that keeps failing in silence reads as a broken
 *  till, and the fact itself is one every colleague on the floor already knows. */
export type CounterPinState = "none" | "ready" | "password-due" | "left";

export async function POST(req: Request) {
    const counterId = thisCounterId();
    if (!counterId) return NextResponse.json({ state: "none" satisfies CounterPinState });

    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    const email = data.email.trim().toLowerCase();
    // Someone standing at the till could otherwise walk a list of addresses through
    // this to learn who signs in here. Same window every other login path uses.
    const throttleKey = `pinstatus:${email}`;
    if (isLoginBlocked(throttleKey, 20)) {
        return NextResponse.json({ state: "none" satisfies CounterPinState });
    }
    recordLoginFailure(throttleKey);

    try {
        const row = await prisma.userCounterPin.findFirst({
            where: { counterId, user: { email } },
            select: { lastPasswordAt: true, lastLoginAt: true, user: { select: { staffProfile: { select: { leftOn: true } } } } },
        });
        if (!row) return NextResponse.json({ state: "none" satisfies CounterPinState });
        if (staffHasLeft(row.user.staffProfile)) return NextResponse.json({ state: "left" satisfies CounterPinState });
        return NextResponse.json({
            state: (pinClocksExpired(row) ? "password-due" : "ready") satisfies CounterPinState,
        });
    } catch (e) {
        return handleApiError(e, "Could not check the PIN");
    }
}
