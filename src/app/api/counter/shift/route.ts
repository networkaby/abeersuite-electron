// GET /api/counter/shift
//
// "Whose drawer is on this counter?" — for the sign-in (lock) screen, before
// anybody is signed in. The next cashier reads it standing at the till: whose
// shift it is, whether it was handed over or just left, the cash expected in the
// drawer and every method the counter takes, with what each collected. It is what they check before
// signing in and accepting the drawer as theirs.
//
// Unauthenticated by necessity, and deliberately narrow — the same fence as
// /api/counter-pin/status:
//   • it answers only inside a counter shell (`thisCounterId()`), so it does not
//     exist on the web deployment at all;
//   • it answers only about the counter the asking PC holds — the figures of the
//     drawer standing in front of whoever is asking, and the name on it;
//   • it takes no input.
//
// Read against the replica (a GET is never relayed): the lock screen has to be
// able to say this with the line down. Silent on every failure — a sign-in screen
// must never be kept from its one job by this panel.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { thisCounterId } from "@/shared/lib/auth/counterPin";
import { buildShiftTenderBreakdown, computeExpectedCash, sumPaise, tillBalancePaise } from "@/modules/pos/lib/shiftMath";

export async function GET() {
    const counterId = thisCounterId();
    if (!counterId) return NextResponse.json(null);

    try {
        const shift = await prisma.posShift.findFirst({
            where:   { counterId, status: { in: ["OPEN", "AWAITING_HANDOVER"] } },
            orderBy: { openedAt: "desc" },
            select: {
                id: true, status: true, openedAt: true,
                user:    { select: { name: true } },
                counter: {
                    select: {
                        name: true, tillAccountId: true,
                        tillAccount:     { select: { id: true } },
                        paymentAccounts: { where: { isActive: true }, select: { channel: true, label: true, accountId: true } },
                    },
                },
                drops:    { select: { amountPaise: true } },
                handover: { select: { status: true, declaredByAPaise: true, initiatedAt: true } },
            },
        });
        if (!shift) return NextResponse.json(null);

        const expected = computeExpectedCash(await tillBalancePaise(prisma, shift.counter.tillAccountId), sumPaise(shift.drops));
        const tenders  = await buildShiftTenderBreakdown(prisma, { shiftId: shift.id, counter: shift.counter, includeZero: true });
        const pending  = shift.status === "AWAITING_HANDOVER" && shift.handover?.status === "PENDING" ? shift.handover : null;
        // The drawer's cash is ONE figure: A's count when A handed over (any gap
        // is booked as Cash Short / Over when B accepts — takeover route), else
        // the books' figure, which B checks and accepts at B's own risk. So no
        // separate Cash tender — the other methods are listed below it.
        const counted  = pending?.declaredByAPaise ?? null;

        return NextResponse.json({
            status:            shift.status,
            cashierName:       shift.user.name,
            counterName:       shift.counter.name,
            openedAt:          shift.openedAt,
            handedOverAt:      pending?.initiatedAt ?? null,
            countedPaise:      counted?.toString() ?? null,
            expectedCashPaise: (counted ?? expected).toString(),
            tenders:           tenders
                .filter((t) => t.method !== "CASH")
                .map((t) => ({ label: t.label, amountPaise: t.amountPaise })),
        });
    } catch {
        return NextResponse.json(null);
    }
}
