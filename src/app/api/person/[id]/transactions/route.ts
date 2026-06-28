import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { parseRange } from "@/modules/accountancy/lib/period";
import { sumReceiptAllocations, loadTenderLines } from "@/modules/accountancy/lib/outstandings";

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
            where:  { personId },
            select: { id: true },
        });

        const rawVouchers = account
            ? await prisma.invVoucher.findMany({
                where: {
                    universalVoucher: { deletedAt: null },   // 5D-8: lifecycle on spine
                    date: { gte: from, lte: to },
                    OR: [
                        { universalVoucher: { partyAccountId: account.id } },   // 5D-4: party on spine
                        // Legacy rows resolve via the partyType+partyId pair.
                        { partyType: "customer", partyId: personId },
                    ],
                },
                select: {
                    id: true,
                    type: true,
                    date: true,
                    totalAmount: true,
                    universalVoucherId: true,
                    branch:    { select: { name: true } },
                    universalVoucher: { select: { createdById: true, partyAccountId: true, voucherNo: true, status: true } },   // 5D-2 creator + 5D-4 party + 5D-6 ref + 5D-8 status
                },
                orderBy: { date: "desc" },
            })
            : [];

        // amountPaid = Σ(non-AR tenders on this voucher) + Σ(later RECEIPT
        // VoucherAllocations against this voucher's spine). Mirrors the per-bill
        // paid calc in src/modules/accountancy/lib/outstandings.ts (loadOpenBills)
        // so customer Transactions and Receivables agree.
        const uvIds = rawVouchers
            .map((v) => v.universalVoucherId)
            .filter((x): x is number => x !== null);
        // RECEIPT settlements + up-front tenders, both via the spine (universalVoucherId).
        const [paidBySpine, tendersBySpine] = await Promise.all([
            sumReceiptAllocations(prisma, uvIds),
            loadTenderLines(prisma, uvIds),
        ]);
        // 5D-2: resolve creator names from each row's spine createdById.
        const creatorIds = [...new Set(rawVouchers.map((v) => v.universalVoucher?.createdById).filter((x): x is number => x != null))];
        const creatorById = new Map(
            (creatorIds.length === 0 ? [] : await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } }))
                .map((u) => [u.id, u.name]),
        );

        const invVouchers = rawVouchers.map((v) => {
            const arAccountId = v.universalVoucher?.partyAccountId ?? account?.id ?? null;
            const nonArTenderSum = (v.universalVoucherId !== null ? (tendersBySpine.get(v.universalVoucherId) ?? []) : [])
                .reduce((s, t) => s + (t.accountId === arAccountId ? 0 : t.amount), 0);
            const jePaid = v.universalVoucherId !== null ? (paidBySpine[v.universalVoucherId] ?? 0) : 0;
            const amountPaid = nonArTenderSum + jePaid;
            return {
                id:         v.id,
                reference:  v.universalVoucher?.voucherNo ?? "",
                type:       v.type,
                status:     v.universalVoucher?.status ?? "DRAFT",
                date:       v.date,
                totalAmount: v.totalAmount,
                amountPaid: amountPaid.toFixed(2),
                branch:     v.branch,
                createdBy:  v.universalVoucher?.createdById != null ? { name: creatorById.get(v.universalVoucher.createdById) ?? null } : null,
            };
        });

        return NextResponse.json({ invVouchers });
    } catch (e) {
        return handleApiError(e, "Failed to load transactions");
    }
}
