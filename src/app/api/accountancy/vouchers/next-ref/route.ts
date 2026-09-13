import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { assembleReference } from "@/modules/accountancy/lib/voucherRef";
import { resolveCounterNumber } from "@/modules/accountancy/lib/balance";

// GET /api/accountancy/vouchers/next-ref?type=JOURNAL
// Preview the next voucher reference (e.g. JOURNAL/26-27/0042) WITHOUT
// incrementing the series. The dialog uses this to show the expected number.
//
// Race-safe? No — and since numbering moved to POST time it is weaker than it
// used to be. The real number is minted atomically by nextRefFromSeries() inside
// the POSTING transaction, from the series of the counter the voucher was RAISED
// on. This preview peeks at THIS machine's row, now. So it is off by more than
// the old ±1 whenever the voucher is saved as a draft and posted later, or
// raised on a counter and posted at the office. Treat it as "what this voucher
// would take if it were posted from here, right now" — an indication, not a
// promise. A draft carries no number at all until it posts.

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const kind = searchParams.get("type") ?? "JOURNAL";

    const series = await prisma.voucherSeries.findUnique({ where: { kind } });
    if (!series) {
        return NextResponse.json({ reference: "" });
    }

    const counterParam = searchParams.get("counterNumber") ?? searchParams.get("counter");
    const counterNumber = resolveCounterNumber(counterParam ? Number(counterParam) : null);
    // The number is per counter; a counter with no row yet starts where the
    // allocator will start it (counter 1 inherits the legacy column).
    const own = await prisma.voucherSeriesCounter.findUnique({ where: { kind_counterNumber: { kind, counterNumber } } });
    const nextSeq = own ? own.nextSeq : counterNumber === 1 ? series.nextSeq : 0;
    const fyStartYear = own?.fyStartYear ?? series.fyStartYear;

    // Mirror what nextRefFromSeries does at save time: it post-increments
    // nextSeq, then calls assembleReference. To preview the same value,
    // pass a shape with nextSeq + 1.
    const reference = assembleReference(
        { ...series, nextSeq: nextSeq + 1, fyStartYear },
        { counterNumber },
    );

    return NextResponse.json({ reference });
}
