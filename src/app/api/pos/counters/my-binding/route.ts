// GET /api/pos/counters/my-binding?deviceId=…&legacyDeviceId=…
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

import { NextResponse, type NextRequest } from "next/server";
import { prismaAuthoritative } from "@/shared/lib/prisma/prismaClient";
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
