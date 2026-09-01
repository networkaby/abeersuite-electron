// GET /api/pos/counters/my-binding?deviceId=…&legacyDeviceId=…[&prefer=local]
//
// "Does this PC still hold a counter, and is its shift still open?" — answered from
// the DB, not from the counter's own replica.
//
// The reconciler used to ask this by fetching the whole counter list, which goes
// through `prisma` — the replica on a counter PC. That made the check circular: the
// row it consulted is the one this same machine writes at shift open, so an admin's
// release only became visible after a pull, and never at all while the machine was
// offline. A check that decides whether to throw a cashier out of the till has to read
// the source of truth, which is exactly what `prismaAuthoritative` is for.
//
// Unreachable is NOT released. When Supabase cannot be reached this returns
// `reachable: false` and the caller keeps trusting its local file — a network blip
// must never sign anyone out mid-shift.
//
// ── prefer=local: the login path ────────────────────────────────────────────
// Login should not wait on the cloud for a machine that plainly already holds a
// counter. With `prefer=local` the replica is consulted FIRST: a binding found there
// is good enough to let the cashier in, because a release is not urgent — the
// reconciler asks authoritatively every five minutes and signs them out when the DB
// says the counter is gone.
//
// Only when the replica knows of no binding does this fall through to the DB, which
// is also the "sync the table before running the wizard" step: a machine whose replica
// is simply behind must not be sent through counter setup it does not need.
//
// The reconciler itself never passes `prefer=local` — a check that can eject someone
// from the till reads the source of truth, always.

import { NextResponse, type NextRequest } from "next/server";
import { prisma, prismaAuthoritative } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";

export async function GET(req: NextRequest) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const ids = [searchParams.get("deviceId"), searchParams.get("legacyDeviceId")]
        .map((v) => v?.trim())
        .filter((v): v is string => !!v);

    // No identity resolved yet (Electron id not ready, bridge not running). We cannot
    // tell "released" from "cannot check", so say so rather than guess.
    if (ids.length === 0) return NextResponse.json({ reachable: false, counter: null });

    try {
        // Local-first, for login only. `prisma` is the replica on a counter PC; a
        // binding it already carries is this machine's own, written when it claimed
        // the counter, so finding it here is a positive answer and not a guess.
        if (searchParams.get("prefer") === "local") {
            const local = await prisma.posCounter.findFirst({
                where:  { boundDeviceId: { in: ids } },
                select: { id: true, counterNumber: true, name: true },
            });
            if (local) {
                const localShift = await prisma.posShift.findFirst({
                    where:  { counterId: local.id, status: { in: ["OPEN", "AWAITING_HANDOVER"] } },
                    select: { id: true, status: true, userId: true },
                });
                return NextResponse.json({ reachable: true, counter: local, openShift: localShift });
            }
            // Nothing locally — fall through and ask the DB, so a replica that is
            // merely behind does not push this PC into the setup wizard.
        }

        const counter = await prismaAuthoritative.posCounter.findFirst({
            where:  { boundDeviceId: { in: ids } },
            select: { id: true, counterNumber: true, name: true },
        });
        if (!counter) return NextResponse.json({ reachable: true, counter: null });

        // The counter's currently live shift, if any. A recovering PC needs this to
        // know whether to resume (still OPEN — the ordinary device swap) or to start a
        // fresh shift (the office force-closed it while this machine was down).
        const openShift = await prismaAuthoritative.posShift.findFirst({
            where:   { counterId: counter.id, status: { in: ["OPEN", "AWAITING_HANDOVER"] } },
            select:  { id: true, status: true, userId: true },
        });

        return NextResponse.json({
            reachable: true,
            counter: { id: counter.id, counterNumber: counter.counterNumber, name: counter.name },
            openShift,
        });
    } catch {
        // Supabase unreachable — the counter keeps billing on its local file.
        return NextResponse.json({ reachable: false, counter: null });
    }
}
