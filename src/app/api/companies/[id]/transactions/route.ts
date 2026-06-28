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

        const rawVouchers = account
            ? await prisma.invVoucher.findMany({
                where: {
                    universalVoucher: { deletedAt: null },   // 5D-8: lifecycle on spine
                    OR: [
                        { universalVoucher: { partyAccountId: account.id } },   // 5D-4: party on spine
                        { partyType: "company", partyId: companyId },
                    ],
                },
                select: {
                    id: true,
                    type: true,
                    totalAmount: true,
                    branch:    { select: { name: true } },
                    universalVoucher: { select: { createdById: true, voucherNo: true, status: true, date: true } },   // 5D-2 creator + 5D-6 ref + 5D-8 status + 5D-10 date
                },
                orderBy: { universalVoucher: { date: "desc" } },   // 5D-10
            })
            : [];

        // 5D-2: resolve creator names from each row's spine createdById.
        const creatorIds = [...new Set(rawVouchers.map((v) => v.universalVoucher?.createdById).filter((x): x is number => x != null))];
        const creatorById = new Map(
            (creatorIds.length === 0 ? [] : await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } }))
                .map((u) => [u.id, u.name]),
        );
        const invVouchers = rawVouchers.map(({ universalVoucher, ...v }) => ({
            ...v,
            date:      universalVoucher?.date,   // 5D-10: date on spine
            status:    universalVoucher?.status ?? "DRAFT",   // 5D-8: status on spine
            reference: universalVoucher?.voucherNo ?? "",   // 5D-6
            createdBy: universalVoucher?.createdById != null ? { name: creatorById.get(universalVoucher.createdById) ?? null } : null,
        }));

        return NextResponse.json({ invVouchers });
    } catch (e) {
        return handleApiError(e, "Failed to load transactions");
    }
}
