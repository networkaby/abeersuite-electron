/**
 * Does this person have a PIN on this counter — and are they still on the staff?
 *
 * Asked by the sign-in screen: to remember on the face card whether a PIN exists (so
 * "Set PIN" reads "Change PIN"), and when a face is tapped, so somebody HR has
 * marked as left is told so instead of being refused in silence. The PIN itself
 * only lifts the counter lock (`/api/counter-lock`); it never signs anyone in.
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
import { thisCounterId } from "@/shared/lib/auth/counterPin";
import { staffHasLeft } from "@/shared/lib/hr/staffStatus";

const schema = z.object({ email: z.string().email() });

/** `left` — HR marked this person as left; no sign-in of any kind, and the shell
 *  drops the face card. The one answer that says something about the person,
 *  and deliberately so: a card that keeps failing in silence reads as a broken
 *  till, and the fact itself is one every colleague on the floor already knows. */
export type CounterPinState = "none" | "ready" | "left";

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
            select: { user: { select: { staffProfile: { select: { leftOn: true } } } } },
        });
        if (!row) return NextResponse.json({ state: "none" satisfies CounterPinState });
        if (staffHasLeft(row.user.staffProfile)) return NextResponse.json({ state: "left" satisfies CounterPinState });
        return NextResponse.json({ state: "ready" satisfies CounterPinState });
    } catch (e) {
        return handleApiError(e, "Could not check the PIN");
    }
}
