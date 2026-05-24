import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";

// GET /api/person/[id]/transactions
//
// Returns every InvVoucher that hits the given person's ledger account.
// Response shape kept as `{ invVouchers }` (the `invoices` array was
// retired with the Invoice → InvVoucher consolidation on 2026-05-24).
export async function GET(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const personId = Number(id);

    try {
        const account = await prisma.account.findFirst({
            where:  { personId },
            select: { id: true },
        });

        const invVouchers = account
            ? await prisma.invVoucher.findMany({
                where: {
                    deletedAt: null,
                    OR: [
                        { accountId: account.id },
                        // Legacy rows written before InvVoucher.accountId existed
                        // still resolve via the partyType+partyId pair.
                        { partyType: "customer", partyId: personId },
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
