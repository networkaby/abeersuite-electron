import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { toNumber, balanceDelta } from "@/modules/accountancy/lib/balance";
import { ensureRestorable, restoreFields, isPosted, lifecycleErrorResponse } from "@/modules/accountancy/lib/voucherLifecycle";

// POST /api/inventory/vouchers/[id]/restore
// Inverse of delete — re-applies stock + GL impact if the voucher was posted.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response, user } = await requirePermission("inventory:voucher:delete");
    if (response) return response;

    const { id } = await params;
    const voucher = await prisma.invVoucher.findUnique({
        where: { id: Number(id) },
        include: { lines: true },
    });
    if (!voucher) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const isPurchase = voucher.type === "PURCHASE" || voucher.type === "RECEIPT" || voucher.type === "GRN";
    const isSale     = voucher.type === "SALE"     || voucher.type === "ISSUE"   || voucher.type === "CHALLAN";

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
    } catch (err) {
        const lifecycle = lifecycleErrorResponse(err);
        if (lifecycle) return lifecycle;
        console.error(err);
        return NextResponse.json({ error: "Failed to restore voucher" }, { status: 500 });
    }
}
