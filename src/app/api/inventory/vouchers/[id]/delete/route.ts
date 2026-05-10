import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { toNumber, balanceDelta } from "@/modules/accountancy/lib/balance";
import { ensureDeletable, deleteFields, isPosted, lifecycleErrorResponse } from "@/modules/accountancy/lib/voucherLifecycle";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const schema = z.object({ reason: z.string().trim().min(1, "Delete reason is required") });

// POST /api/inventory/vouchers/[id]/delete
// Soft-delete: hides from views and reverses stock/GL impact for posted vouchers. Recoverable.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response, user } = await requirePermission(PERMISSIONS.INVENTORY_VOUCHER_DELETE);
    if (response) return response;

    const { id } = await params;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    const voucher = await prisma.invVoucher.findUnique({
        where: { id: Number(id) },
        include: { lines: true },
    });
    if (!voucher) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const isPurchase = voucher.type === "PURCHASE" || voucher.type === "RECEIPT" || voucher.type === "GRN";
    const isSale     = voucher.type === "SALE"     || voucher.type === "ISSUE"   || voucher.type === "CHALLAN";

    try {
        ensureDeletable(voucher);

        await prisma.$transaction(async (tx) => {
            if (isPosted(voucher)) {
                // Reverse stock + cached balance — same shape as cancel, but no counter-entry written.
                for (const line of voucher.lines) {
                    const qty = toNumber(line.quantity);
                    await tx.invStockLedger.create({
                        data: {
                            productId: line.productId,
                            voucherId: voucher.id,
                            date:      new Date(),
                            inQty:     isSale     ? qty : 0,
                            outQty:    isPurchase ? qty : 0,
                            rate:      line.rate,
                            amount:    -toNumber(line.amount),
                        },
                    });
                    await tx.invProduct.update({
                        where: { id: line.productId },
                        data:  {
                            stock: isPurchase
                                ? { decrement: Math.round(qty) }
                                : isSale
                                ? { increment: Math.round(qty) }
                                : undefined,
                        },
                    });
                }

                if (voucher.journalEntryId) {
                    const origJe = await tx.journalEntry.findUnique({
                        where: { id: voucher.journalEntryId },
                        include: { lines: { include: { account: { select: { normalBalance: true } } } } },
                    });
                    if (origJe && origJe.status === "POSTED" && !origJe.deletedAt) {
                        for (const line of origJe.lines) {
                            const delta = balanceDelta(line.account.normalBalance!, line.type, toNumber(line.amount));
                            await tx.account.update({ where: { id: line.accountId }, data: { balance: { decrement: delta } } });
                        }
                        await tx.journalEntry.update({
                            where: { id: origJe.id },
                            data: {
                                deletedAt: new Date(),
                                deletedById: user!.id,
                                deleteReason: `Voucher ${voucher.reference} deleted: ${data.reason}`,
                            },
                        });
                    }
                }
            }

            await tx.invVoucher.update({
                where: { id: Number(id) },
                data: deleteFields(user!.id, data.reason),
            });
        });

        const updated = await prisma.invVoucher.findUnique({ where: { id: Number(id) } });
        return NextResponse.json(updated);
    } catch (e) {
        const lifecycle = lifecycleErrorResponse(e);
        if (lifecycle) return lifecycle;
        return handleApiError(e, "Failed to delete voucher");
    }
}
