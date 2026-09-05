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
            // The number itself is per counter (see VoucherSeriesCounter); the page
            // shows counter 1's on the row and the rest as a list.
            include: { counters: { orderBy: { counterNumber: "asc" }, select: { counterNumber: true, nextSeq: true, fyStartYear: true } } },
        });

        // Sort in logical order rather than alphabetical.
        // GL -> Sales -> Purchases -> Inventory -> Services / Repairs
        const ORDER = [
            "CONTRA", "PAYMENT", "RECEIPT", "CREDIT_NOTE", "DEBIT_NOTE", "JOURNAL",
            "SALE", "POS", "ONLINE_INVOICE", "ONLINE_ORDER", "ESTIMATE", "SALE_RETURN",
            "PURCHASE", "PURCHASE_RETURN", "SALES_ORDER", "PURCHASE_ORDER",
            "GRN", "CHALLAN", "MANUFACTURING_JOURNAL", "PHYSICAL_STOCK", "BRANCH_TRANSFER",
            "REJECTION_IN", "REJECTION_OUT",
            "REPAIR_TICKET",
        ];
        series.sort((a: { kind: string; label: string }, b: { kind: string; label: string }) => {
            const idxA = ORDER.indexOf(a.kind);
            const idxB = ORDER.indexOf(b.kind);
            const rankA = idxA === -1 ? 999 : idxA;
            const rankB = idxB === -1 ? 999 : idxB;
            if (rankA !== rankB) return rankA - rankB;
            return a.label.localeCompare(b.label);
        });

        return NextResponse.json(series);
    } catch (e) {
        return handleApiError(e, "Failed to fetch voucher series");
    }
}
