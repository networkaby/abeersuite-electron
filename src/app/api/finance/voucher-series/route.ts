import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { seedVoucherSeries } from "@/modules/accountancy/lib/seedVoucherSeries";

// GET /api/finance/voucher-series
// Returns all 7 VoucherSeries rows. Auto-seeds on first call if the table is empty.
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;

    try {
        const count = await prisma.voucherSeries.count();
        if (count === 0) {
            await seedVoucherSeries(prisma);
        }

        const series = await prisma.voucherSeries.findMany({
            orderBy: [
                // Fixed display order matching Tally convention
                { kind: "asc" },
            ],
        });

        // Sort in logical order rather than alphabetical
        const ORDER = ["CONTRA", "PAYMENT", "RECEIPT", "CREDIT_NOTE", "DEBIT_NOTE", "INVOICE", "JOURNAL"];
        series.sort((a: { kind: string }, b: { kind: string }) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));

        return NextResponse.json(series);
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to fetch voucher series" }, { status: 500 });
    }
}
