import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { parseRange } from "@/modules/accountancy/lib/period";
import {
    CUSTOMER_ACCOUNT_OPENING_SELECT,
    loadCustomerTransactionVouchers,
} from "@/modules/customer/lib/customerTransactions";

// GET /api/person/[id]/transactions?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Returns every InvVoucher that hits the given person's ledger account.
// Optional from/to clamp the voucher date to a period (defaults to the
// current Indian fiscal year, matching the account-ledger view).
// Response shape kept as `{ invVouchers }` (the `invoices` array was
// retired with the Invoice → InvVoucher consolidation on 2026-05-24).
export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const personId = Number(id);
    const { from, to } = parseRange(new URL(request.url).searchParams);

    try {
        const account = await prisma.account.findFirst({
            where: { personId },
            select: CUSTOMER_ACCOUNT_OPENING_SELECT,
        });

        const invVouchers = await loadCustomerTransactionVouchers(
            prisma,
            account,
            { partyType: "customer", partyId: personId },
            from,
            to,
        );

        return NextResponse.json({ invVouchers });
    } catch (e) {
        return handleApiError(e, "Failed to load transactions");
    }
}
