import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { seedVoucherSeries } from "@/modules/accountancy/lib/seedVoucherSeries";
import { handleApiError } from "@/shared/lib/api";

// GET /api/accountancy/voucher-series
// Returns all 7 VoucherSeries rows. Auto-seeds on first call if the table is empty.
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;

    try {
        // Always-run seed: uses skipDuplicates so existing rows aren't touched,
        // but newly-added kinds (e.g. SALE / PURCHASE / ESTIMATE for inventory
        // vouchers) get auto-inserted on first visit after the seed expands.
        await seedVoucherSeries(prisma);

        const series = await prisma.voucherSeries.findMany({
            orderBy: [
                // Fixed display order matching Tally convention
                { kind: "asc" },
            ],
        });

        // Sort in logical order rather than alphabetical. Inventory voucher
        // kinds appear after the GL kinds since they roll up into stock + GL.
        const ORDER = [
            "CONTRA", "PAYMENT", "RECEIPT", "CREDIT_NOTE", "DEBIT_NOTE",
            "INVOICE", "JOURNAL",
            "SALE", "POS", "PURCHASE", "ESTIMATE",
            "SALE_RETURN", "PURCHASE_RETURN",
        ];
        series.sort((a: { kind: string }, b: { kind: string }) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));

        return NextResponse.json(series);
    } catch (e) {
        return handleApiError(e, "Failed to fetch voucher series");
    }
}
