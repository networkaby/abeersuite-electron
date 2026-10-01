import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { assembleReference } from "@/modules/accountancy/lib/voucherRef";
import { resolveCounterNumber } from "@/modules/accountancy/lib/balance";
import { InvVoucherType } from "@/generated/prisma/client";
import { SERIES_KINDS } from "@/modules/inventory/lib/stock";

// GET /api/inventory/vouchers/next-ref?type=SALE|PURCHASE|ESTIMATE
//
// Preview-only — reads the configured VoucherSeries row (managed at
// /office/settings/year-ending) and assembles the *next* reference WITHOUT
// incrementing the counter. The actual reference is generated atomically
// at save time via invNextRef() inside the transaction; if two users save
// concurrently the live reference may differ by ±1 from this preview.
//
// The kind map is the allocator's own (SERIES_KINDS), so a preview can never
// promise a format the save would not use.

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const type = (searchParams.get("type") ?? "SALE") as InvVoucherType;
    const kind = SERIES_KINDS[type];
    if (!kind) return NextResponse.json({ reference: "" });

    const series = await prisma.voucherSeries.findUnique({ where: { kind } });
    if (!series) return NextResponse.json({ reference: "" });

    const counterParam = searchParams.get("counterNumber") ?? searchParams.get("counter");
    const counterNumber = resolveCounterNumber(counterParam ? Number(counterParam) : null);
    // The number is per counter; a counter with no row yet starts where the
    // allocator will start it (counter 1 inherits the legacy column).
    const own = await prisma.voucherSeriesCounter.findUnique({ where: { kind_counterNumber: { kind, counterNumber } } });
    const nextSeq = own ? own.nextSeq : counterNumber === 1 ? series.nextSeq : 0;
    const fyStartYear = own?.fyStartYear ?? series.fyStartYear;

    const reference = assembleReference(
        { ...series, nextSeq: nextSeq + 1, fyStartYear },
        { counterNumber },
    );
    return NextResponse.json({ reference });
}
