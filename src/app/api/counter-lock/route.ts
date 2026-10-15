/**
 * The counter's soft lock — read it, set it, lift it.
 *
 * Owner, 2026-10-13: Lock (and the idle timer) only COVERS a till; the login stays
 * alive behind the cover and the person's own 4-digit PIN lifts it at once. A full
 * sign-out happens only on: 10 days since the password, 3 idle days, somebody else
 * signing in, 5 wrong PINs, or "Sign out fully".
 *
 *   GET                          → { enabled, locked, hasPin, lockedAt }
 *   POST { action: "lock", lastInputAt? }
 *   POST { action: "unlock", pin? | password? }
 *        → { ok: true } | { ok: false, error, triesLeft } | { signedOut: true, error }
 *
 * The secret is checked HERE, on the till, against its own replica — no trip to the
 * office, which is why unlocking is instant and works with the line down. The PIN row
 * is per counter (`counterPin.ts`); somebody with no PIN on this till unlocks with the
 * password instead. Lock and unlock both move the PIN's idle clock; 5 wrong tries
 * make the password due for the PIN sign-in too.
 *
 * A BOOT lock (`userId: ""`, written by the desktop shell on a start that finds a
 * login alive) is adopted by the first login that asks — the till has one.
 *
 * Counters only: off a counter `enabled` is false and the screen signs out as before.
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { stampCounterPin, thisCounterId } from "@/shared/lib/auth/counterPin";
import { readLocalLock, writeLocalLock, type LocalLock } from "@/shared/lib/auth/localLock";
import { markLocalSignOut } from "@/shared/lib/auth/localSignOut";
import { LOGIN_IDLE_LABEL, LOGIN_IDLE_MAX_AGE_MS, UNLOCK_MAX_FAILURES } from "@/shared/lib/constants/session";

const schema = z.discriminatedUnion("action", [
    z.object({ action: z.literal("lock"), lastInputAt: z.number().optional() }),
    z.object({ action: z.literal("unlock"), pin: z.string().optional(), password: z.string().optional() }),
]);

/** End the login on this till for good — the same mark Sign out writes. */
function signOutHere(userId: string, error: string) {
    markLocalSignOut(userId);
    writeLocalLock(null);
    return NextResponse.json({ signedOut: true, error });
}

/** The lock on this till, with a boot lock made this person's. */
function readLockFor(userId: string): LocalLock | null {
    const lock = readLocalLock();
    if (lock?.userId !== "") return lock;
    const mine = { ...lock, userId };
    writeLocalLock(mine);
    return mine;
}

export async function GET() {
    const { user, response } = await requireAuth();
    if (response) return response;

    const counterId = thisCounterId();
    if (!counterId) return NextResponse.json({ enabled: false, locked: false, hasPin: false });

    try {
        const lock = readLockFor(String(user.id));
        const pin = await prisma.userCounterPin.findUnique({
            where: { userId_counterId: { userId: Number(user.id), counterId } },
            select: { userId: true },
        });
        const mine = lock?.userId === String(user.id);
        return NextResponse.json({ enabled: true, locked: mine, hasPin: !!pin, lockedAt: mine ? lock!.lockedAt : null });
    } catch (e) {
        return handleApiError(e, "Could not read the counter lock");
    }
}

export async function POST(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const counterId = thisCounterId();
    if (!counterId) {
        return NextResponse.json({ error: "Only a counter can be locked.", code: "NOT_A_COUNTER" }, { status: 400 });
    }

    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    const userId = String(user.id);
    const now = Date.now();

    try {
        const lock = readLockFor(userId);

        if (data.action === "lock") {
            // Already locked by this person (another window got there first): keep the
            // earlier moment, which is when they actually stopped working.
            if (lock?.userId === userId) return NextResponse.json({ ok: true });
            const at = data.lastInputAt && data.lastInputAt <= now ? data.lastInputAt : now;
            writeLocalLock({ userId, lockedAt: at, failures: 0 });
            await stampCounterPin(prisma, Number(userId), "used", new Date(at));
            return NextResponse.json({ ok: true });
        }

        // ── unlock ───────────────────────────────────────────────────────────
        if (lock?.userId !== userId) return NextResponse.json({ ok: true });   // not locked: nothing to lift

        // The 3-day idle rule. A locked till keeps polling, which rolls the cookie on
        // for ever, so the cookie's own lifetime cannot see this — the lock can.
        if (now - lock.lockedAt > LOGIN_IDLE_MAX_AGE_MS) {
            return signOutHere(userId, `Not used for ${LOGIN_IDLE_LABEL} — sign in with your password.`);
        }

        let right = false;
        if (data.pin) {
            const row = await prisma.userCounterPin.findUnique({
                where: { userId_counterId: { userId: Number(userId), counterId } },
                select: { pinHash: true },
            });
            right = !!row && await bcrypt.compare(data.pin, row.pinHash);
        } else if (data.password) {
            const row = await prisma.user.findUnique({ where: { id: Number(userId) }, select: { password: true } });
            right = !!row && await bcrypt.compare(data.password, row.password);
        }

        if (right) {
            writeLocalLock(null);
            await stampCounterPin(prisma, Number(userId), data.pin ? "used" : "password");
            return NextResponse.json({ ok: true });
        }

        const failures = lock.failures + 1;
        if (failures >= UNLOCK_MAX_FAILURES) {
            await stampCounterPin(prisma, Number(userId), "expire");
            return signOutHere(userId, `${UNLOCK_MAX_FAILURES} wrong tries — sign in with your password.`);
        }
        writeLocalLock({ ...lock, failures });
        return NextResponse.json({
            ok: false,
            error: data.pin ? "That PIN is not right." : "That password is not right.",
            triesLeft: UNLOCK_MAX_FAILURES - failures,
        });
    } catch (e) {
        return handleApiError(e, "Could not unlock the counter");
    }
}
