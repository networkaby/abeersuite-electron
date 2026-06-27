import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, userCanVoucher } from "@/shared/lib/auth/permissions";
import { balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { setSpineLifecycle } from "@/modules/accountancy/lib/transactionEngine";
import { ensureRestorable, restoreFields, isPosted, lifecycleErrorResponse } from "@/modules/accountancy/lib/voucherLifecycle";
import { handleApiError } from "@/shared/lib/api";

// POST /api/accountancy/vouchers/[id]/restore
// Inverse of delete — re-applies GL impact if the voucher was posted.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const voucher = await prisma.voucher.findUnique({
        where: { id: Number(id) },
        include: { lines: { include: { account: { select: { normalBalance: true } } } } },
    });
    if (!voucher) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Per-kind delete gate (restore is the inverse of delete; falls back to generic).
    if (!userCanVoucher(user, voucher.type, "delete")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
        ensureRestorable(voucher);

        await prisma.$transaction(async (tx) => {
            if (isPosted(voucher)) {
                for (const line of voucher.lines) {
                    const delta = balanceDelta(line.account.normalBalance!, line.type, toNumber(line.amount));
                    await tx.account.update({ where: { id: line.accountId }, data: { balance: { increment: delta } } });
                }
                if (voucher.journalEntryId) {
                    await setSpineLifecycle(tx, voucher.journalEntryId, { deletedAt: null, deletedById: null, deleteReason: null });
                }
            }

            // Phase 5 5.0d: undelete the DRAFT voucher's draft spine with it.
            if (!isPosted(voucher) && voucher.universalVoucherId) {
                await setSpineLifecycle(tx, voucher.universalVoucherId, { deletedAt: null, deletedById: null, deleteReason: null });
            }

            await tx.voucher.update({
                where: { id: voucher.id },
                data:  restoreFields(),
            });
        // Per-line balance re-apply over the Supabase pooler can exceed the
        // default 5s interactive-tx ceiling (P2028) — match 30s.
        }, { timeout: 30_000, maxWait: 10_000 });

        const restored = await prisma.voucher.findUnique({ where: { id: Number(id) } });
        return NextResponse.json(restored);
    } catch (e) {
        const lifecycle = lifecycleErrorResponse(e);
        if (lifecycle) return lifecycle;
        return handleApiError(e, "Failed to restore voucher");
    }
}
