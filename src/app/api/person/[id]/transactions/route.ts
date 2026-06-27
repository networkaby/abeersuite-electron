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
                    deletedAt: null,
                    date: { gte: from, lte: to },
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
                    accountId: true,
                    universalVoucherId: true,
                    branch:    { select: { name: true } },
                    createdBy: { select: { name: true } },
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

        const invVouchers = rawVouchers.map((v) => {
            const arAccountId = v.accountId ?? account?.id ?? null;
            const nonArTenderSum = (v.universalVoucherId !== null ? (tendersBySpine.get(v.universalVoucherId) ?? []) : [])
                .reduce((s, t) => s + (t.accountId === arAccountId ? 0 : t.amount), 0);
            const jePaid = v.universalVoucherId !== null ? (paidBySpine[v.universalVoucherId] ?? 0) : 0;
            const amountPaid = nonArTenderSum + jePaid;
            return {
                id:         v.id,
                reference:  v.reference,
                type:       v.type,
                status:     v.status,
                date:       v.date,
                totalAmount: v.totalAmount,
                amountPaid: amountPaid.toFixed(2),
                branch:     v.branch,
                createdBy:  v.createdBy,
            };
        });

        return NextResponse.json({ invVouchers });
    } catch (e) {
        return handleApiError(e, "Failed to load transactions");
    }
}
