// GET /api/counter/day
//
// The duty card for the lock screen when nobody has just signed out here — after
// an app restart, a fresh install, the first thing in the morning. Answers with
// the day of whoever last ran a shift on this counter.
//
// Owner, 2026-09-25: the card should always show, not only straight after a
// sign-out. Same fence as /api/counter/shift: counter shells only, only this
// counter, no input, silent on every failure.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { thisCounterId } from "@/shared/lib/auth/counterPin";
import { buildMyDay } from "@/modules/hr/lib/myDayServer";

export async function GET() {
    const counterId = thisCounterId();
    if (!counterId) return NextResponse.json(null);

    try {
        const last = await prisma.posShift.findFirst({
            where:   { counterId },
            orderBy: { openedAt: "desc" },
            select:  { userId: true },
        });
        if (!last) return NextResponse.json(null);
        return NextResponse.json(await buildMyDay(last.userId));
    } catch {
        return NextResponse.json(null);
    }
}
