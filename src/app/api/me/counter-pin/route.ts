/**
 * Your own counter PIN. Nobody else's, ever.
 *
 * Deliberately under `/api/me` rather than `/api/users/[id]` like the password route:
 * there is no id to pass, so there is no way to aim this at another person, and no
 * admin branch to get wrong. An owner can disable a departing cashier's account —
 * which the PIN sign-in already respects, since it loads the same user — but nobody
 * can hand out or change somebody else's PIN.
 *
 * `PUT` always means "for the counter this request came from". The counter is read
 * from the server's own environment (`thisCounterId`), never from the body: a counter
 * id a client can choose is a counter id an attacker can choose.
 *
 * Writes go through `prismaAuthoritative` — the office books, not the replica. Two
 * reasons. A PIN hash is the one thing on this table a counter must never push
 * upstream, and "reset on all counters" has to be TRUE the moment it returns, not
 * whenever the outbox next drains. So saving or resetting a PIN needs the line up,
 * while using one works offline. The dialog says so.
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prismaAuthoritative } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { thisCounterId, validatePin } from "@/shared/lib/auth/counterPin";

const schema = z.object({
    pin: z.string(),
    /** The password, retyped. Setting a PIN is handing out a second key to this
     *  account — an unattended till with a session open must not be enough. */
    password: z.string().min(1, "Enter your password"),
});

export async function PUT(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const counterId = thisCounterId();
    if (!counterId) {
        return NextResponse.json(
            { error: "A PIN can only be set on the counter it is for.", code: "NOT_A_COUNTER" },
            { status: 400 },
        );
    }

    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    const check = validatePin(data.pin);
    if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 400 });

    try {
        const row = await prismaAuthoritative.user.findUnique({
            where: { id: user.id },
            select: { password: true },
        });
        if (!row || !await bcrypt.compare(data.password, row.password)) {
            return NextResponse.json({ error: "That password is not right." }, { status: 403 });
        }

        const pinHash = await bcrypt.hash(data.pin, 10);
        const now = new Date();
        await prismaAuthoritative.userCounterPin.upsert({
            where: { userId_counterId: { userId: user.id, counterId } },
            // They just typed the password, so both clocks start now.
            create: { userId: user.id, counterId, pinHash, lastPasswordAt: now, lastLoginAt: now },
            update: { pinHash, lastPasswordAt: now, lastLoginAt: now },
        });
        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Could not save your PIN");
    }
}

/** `?scope=all` clears every counter; anything else clears this one. */
export async function DELETE(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const all = new URL(req.url).searchParams.get("scope") === "all";
    const counterId = thisCounterId();
    if (!all && !counterId) {
        return NextResponse.json(
            { error: "This is not a counter, so there is no PIN here to remove.", code: "NOT_A_COUNTER" },
            { status: 400 },
        );
    }

    try {
        await prismaAuthoritative.userCounterPin.deleteMany({
            where: all ? { userId: user.id } : { userId: user.id, counterId: counterId! },
        });
        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Could not remove your PIN");
    }
}
