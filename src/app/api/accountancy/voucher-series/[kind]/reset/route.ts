import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";

// POST /api/accountancy/voucher-series/[kind]/reset
// Resets nextSeq to 0 on EVERY counter's row for the kind (and the legacy column).
// Used at year-end to restart numbering from startFrom.
export async function POST(
    _: Request,
    { params }: { params: Promise<{ kind: string }> },
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { kind } = await params;

    try {
        const series = await prisma.$transaction(async (tx) => {
            await tx.voucherSeriesCounter.updateMany({ where: { kind }, data: { nextSeq: 0 } });
            return tx.voucherSeries.update({
                where: { kind },
                data: { nextSeq: 0 },
                include: { counters: { orderBy: { counterNumber: "asc" }, select: { counterNumber: true, nextSeq: true, fyStartYear: true } } },
            });
        });
        return NextResponse.json(series);
    } catch {
        return NextResponse.json({ error: "Voucher series not found" }, { status: 404 });
    }
}
