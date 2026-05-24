import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";

// GET /api/companies/[id]/transactions
//
// Returns every InvVoucher that hits the given company's ledger account.
// Response shape kept as `{ invVouchers }` (the `invoices` array was
// retired with the Invoice → InvVoucher consolidation on 2026-05-24).
export async function GET(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const companyId = Number(id);

    try {
        const account = await prisma.account.findFirst({
            where:  { companyId },
            select: { id: true },
        });

        const invVouchers = account
            ? await prisma.invVoucher.findMany({
                where: {
                    deletedAt: null,
                    OR: [
                        { accountId: account.id },
                        { partyType: "company", partyId: companyId },
                    ],
                },
                select: {
                    id: true,
                    reference: true,
                    type: true,
                    status: true,
                    date: true,
                    totalAmount: true,
                    branch:    { select: { name: true } },
                    createdBy: { select: { name: true } },
                },
                orderBy: { date: "desc" },
            })
            : [];

        return NextResponse.json({ invVouchers });
    } catch (e) {
        return handleApiError(e, "Failed to load transactions");
    }
}
