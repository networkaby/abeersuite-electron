import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";

export async function GET(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const personId = Number(id);

    try {
        const [invoices, invVouchers] = await Promise.all([
            prisma.invoice.findMany({
                where: { account: { personId }, deletedAt: null },
                select: {
                    id: true,
                    number: true,
                    status: true,
                    issueDate: true,
                    totalAmount: true,
                    amountPaid: true,
                },
                orderBy: { issueDate: "desc" },
            }),
            prisma.invVoucher.findMany({
                where: { partyType: "customer", partyId: personId, deletedAt: null },
                select: {
                    id: true,
                    reference: true,
                    type: true,
                    status: true,
                    date: true,
                    totalAmount: true,
                    amountReceived: true,
                    branch:    { select: { name: true } },
                    createdBy: { select: { name: true } },
                },
                orderBy: { date: "desc" },
            }),
        ]);

        return NextResponse.json({ invoices, invVouchers });
    } catch (e) {
        return handleApiError(e, "Failed to load transactions");
    }
}
