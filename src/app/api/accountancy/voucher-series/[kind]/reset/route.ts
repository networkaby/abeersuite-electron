import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";

// POST /api/accountancy/voucher-series/[kind]/reset
//
// Restarts the series from `startFrom`. The office is counter 1, so its own row (and
// the legacy `VoucherSeries.nextSeq` the Year Ending page reads) is zeroed here and
// now. Every OTHER counter's row is never written from here: each `(kind, counter)`
// row has exactly one writer — the machine numbering on it — and an office write
// would land on top of an offline till's queued increments under last-write-wins,
// re-issuing numbers already printed. Instead the series' `resetGen` is bumped, and
// each counter zeroes its own row the next time it numbers (`nextRefFromSeries`).
export async function POST(
    _: Request,
    { params }: { params: Promise<{ kind: string }> },
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { kind } = await params;

    try {
        const series = await prisma.$transaction(async (tx) => {
            const bumped = await tx.voucherSeries.update({
                where: { kind },
                data: { nextSeq: 0, resetGen: { increment: 1 } },
                select: { resetGen: true },
            });
            // Counter 1 only. `updateMany` so a series that has never numbered (no row
            // yet) is not an error; the row is created at the current generation on
            // first use.
            await tx.voucherSeriesCounter.updateMany({
                where: { kind, counterNumber: 1 },
                data: { nextSeq: 0, resetGen: bumped.resetGen },
            });
            return tx.voucherSeries.findUniqueOrThrow({
                where: { kind },
                include: { counters: { orderBy: { counterNumber: "asc" }, select: { counterNumber: true, nextSeq: true, fyStartYear: true } } },
            });
        });
        return NextResponse.json(series);
    } catch {
        return NextResponse.json({ error: "Voucher series not found" }, { status: 404 });
    }
}
