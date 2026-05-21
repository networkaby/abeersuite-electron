import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { toNumber, balanceDelta } from "@/modules/accountancy/lib/balance";
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
                for (const line of voucher.lines) {
                    const qty = toNumber(line.quantity);
                    await tx.invStockLedger.create({
                        data: {
                            productId: line.productId,
                            voucherId: voucher.id,
                            branchId:  voucher.branchId,
                            date:      new Date(),
                            inQty:     isPurchase ? qty : 0,
                            outQty:    isSale     ? qty : 0,
                            rate:      line.rate,
                            amount:    toNumber(line.amount),
                        },
                    });
                    await tx.invProduct.update({
                        where: { id: line.productId },
                        data:  {
                            stock: isPurchase
                                ? { increment: Math.round(qty) }
                                : isSale
                                ? { decrement: Math.round(qty) }
                                : undefined,
                        },
                    });
                    if (isPurchase || isSale) {
                        await tx.invProductBranch.upsert({
                            where:  { productId_branchId: { productId: line.productId, branchId: voucher.branchId } },
                            create: { productId: line.productId, branchId: voucher.branchId, stock: isPurchase ? Math.round(qty) : -Math.round(qty) },
                            update: { stock: isPurchase ? { increment: Math.round(qty) } : { decrement: Math.round(qty) } },
                        });
                    }
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
