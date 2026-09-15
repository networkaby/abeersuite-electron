import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { parseRange } from "@/modules/accountancy/lib/period";
import {
    CUSTOMER_ACCOUNT_OPENING_SELECT,
    loadCustomerTransactionVouchers,
} from "@/modules/customer/lib/customerTransactions";

// GET /api/companies/[id]/transactions?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Returns every InvVoucher that hits the given company's ledger account.
// Response shape kept as `{ invVouchers }` (the `invoices` array was
// retired with the Invoice → InvVoucher consolidation on 2026-05-24).
export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const companyId = Number(id);
    const { from, to } = parseRange(new URL(request.url).searchParams);

    try {
        const account = await prisma.account.findFirst({
            where: { companyId },
            select: CUSTOMER_ACCOUNT_OPENING_SELECT,
        });

        const invVouchers = await loadCustomerTransactionVouchers(
            prisma,
            account,
            { partyType: "company", partyId: companyId },
            from,
            to,
        );

        return NextResponse.json({ invVouchers, accountId: account?.id ?? null });
    } catch (e) {
        return handleApiError(e, "Failed to load transactions");
    }
}
