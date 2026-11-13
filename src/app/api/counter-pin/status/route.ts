/**
 * Can this person sign in with their PIN on this counter, right now?
 *
 * Asked by the sign-in screen when a face is tapped, before it puts the keypad up,
 * and on the way in to remember on the face card whether a PIN exists. The answer
 * tells the refusals apart — "wrong PIN" and "the 10 days are up" look identical to a
 * cashier at 9am, and the second is not a mistake they made — and somebody HR has
 * marked as left is told so instead of being refused in silence.
 *
 * Unauthenticated by necessity — nobody is signed in yet — and therefore deliberately
 * narrow: it answers only inside a counter shell (`thisCounterId`), only about the
 * counter the asking PC holds, and an unknown email and one with no PIN on this
 * counter give the same "none".
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { isLoginBlocked, recordLoginFailure } from "@/shared/lib/auth/loginRateLimit";
import { pinClocksExpired, thisCounterId } from "@/shared/lib/auth/counterPin";
import { staffHasLeft } from "@/shared/lib/hr/staffStatus";

const schema = z.object({ email: z.string().email() });

/** `ready` — the keypad. `password-due` — a PIN exists but its clocks have run out
 *  (`counterPin.ts`), so the password, once, and the PIN works again after it.
 *  `left` — HR marked this person as left; no sign-in of any kind, and the shell
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
    if (await isLoginBlocked(throttleKey, 20)) {
        return NextResponse.json({ state: "none" satisfies CounterPinState });
    }
    await recordLoginFailure(throttleKey);

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
