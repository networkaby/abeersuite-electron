import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { toNumber, balanceDelta } from "@/modules/accountancy/lib/balance";
import { recordStockMovement } from "@/modules/inventory/lib/stockMovement";
import { ensureRestorable, restoreFields, isPosted, lifecycleErrorResponse } from "@/modules/accountancy/lib/voucherLifecycle";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// POST /api/inventory/vouchers/[id]/restore
// Inverse of delete — re-applies stock + GL impact if the voucher was posted.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response, user } = await requirePermission(PERMISSIONS.INVENTORY_VOUCHER_DELETE);
    if (response) return response;

    const { id } = await params;
    const voucher = await prisma.invVoucher.findUnique({
        where: { id: Number(id) },
        include: { lines: true },
    });
    if (!voucher) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const isPurchase = voucher.type === "PURCHASE" || voucher.type === "GRN";
    const isSale     = voucher.type === "SALE"     || voucher.type === "CHALLAN";

    try {
        ensureRestorable(voucher);

        await prisma.$transaction(async (tx) => {
            if (isPosted(voucher)) {
                const now = new Date();
                for (const line of voucher.lines) {
                    const qty = toNumber(line.quantity);
                    // Non-sale, non-purchase types still write a zero-qty audit
                    // row; the helper's delta === 0 guard skips cache updates.
                    await recordStockMovement(tx, {
                        voucherId: voucher.id,
                        productId: line.productId,
                        branchId:  voucher.branchId,
                        date:      now,
                        inQty:     isPurchase ? qty : 0,
                        outQty:    isSale     ? qty : 0,
                        rate:      line.rate,
                        amount:    toNumber(line.amount),
                        updateBranchBalance: isPurchase || isSale,
                    });
                }

                if (voucher.journalEntryId) {
                    const origJe = await tx.journalEntry.findUnique({
                        where: { id: voucher.journalEntryId },
                        include: { lines: { include: { account: { select: { normalBalance: true } } } } },
                    });
                    if (origJe && origJe.deletedAt) {
                        for (const line of origJe.lines) {
                            const delta = balanceDelta(line.account.normalBalance!, line.type, toNumber(line.amount));
                            await tx.account.update({ where: { id: line.accountId }, data: { balance: { increment: delta } } });
                        }
                        await tx.journalEntry.update({
                            where: { id: origJe.id },
                            data: { deletedAt: null, deletedById: null, deleteReason: null },
                        });
                    }
                }
            }

            await tx.invVoucher.update({
                where: { id: Number(id) },
                data: restoreFields(),
            });
            void user;
        });

        const restored = await prisma.invVoucher.findUnique({ where: { id: Number(id) } });
        return NextResponse.json(restored);
    } catch (e) {
        const lifecycle = lifecycleErrorResponse(e);
        if (lifecycle) return lifecycle;
        return handleApiError(e, "Failed to restore voucher");
    }
}
