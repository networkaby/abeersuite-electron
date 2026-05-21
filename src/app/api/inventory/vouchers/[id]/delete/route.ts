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

    const isPurchase = voucher.type === "PURCHASE" || voucher.type === "GRN";
    const isSale     = voucher.type === "SALE"     || voucher.type === "CHALLAN";
    const isBranchTransfer = voucher.type === "BRANCH_TRANSFER";
    const isLedgerMirror = voucher.type === "PHYSICAL_STOCK" || voucher.type === "MANUFACTURING_JOURNAL";

    try {
        ensureDeletable(voucher);

        await prisma.$transaction(async (tx) => {
            if (isPosted(voucher)) {
                // Reverse stock + cached balance — same shape as cancel, but no counter-entry written.
                if (isLedgerMirror) {
                    // Mirror the original ledger rows in reverse; patch both
                    // InvProductBranch.stock and InvProduct.stock by the
                    // opposite of the original delta.
                    const origRows = await tx.invStockLedger.findMany({
                        where:  { voucherId: voucher.id, amount: { gte: 0 } },
                        select: { id: true, productId: true, branchId: true, inQty: true, outQty: true, rate: true, amount: true },
                    });
                    for (const row of origRows) {
                        const inN  = toNumber(row.inQty);
                        const outN = toNumber(row.outQty);
                        await tx.invStockLedger.create({
                            data: {
                                productId: row.productId,
                                voucherId: voucher.id,
                                branchId:  row.branchId,
                                date:      new Date(),
                                inQty:     outN,
                                outQty:    inN,
                                rate:      row.rate,
                                amount:    -toNumber(row.amount),
                            },
                        });
                        const originalDelta = Math.round(inN - outN);
                        if (originalDelta !== 0) {
                            const reverseDelta = -originalDelta;
                            await tx.invProductBranch.upsert({
                                where:  { productId_branchId: { productId: row.productId, branchId: row.branchId } },
                                create: { productId: row.productId, branchId: row.branchId, stock: reverseDelta },
                                update: { stock: reverseDelta > 0 ? { increment: reverseDelta } : { decrement: -reverseDelta } },
                            });
                            await tx.invProduct.update({
                                where: { id: row.productId },
                                data:  { stock: reverseDelta > 0 ? { increment: reverseDelta } : { decrement: -reverseDelta } },
                            });
                        }
                    }
                } else if (isBranchTransfer && voucher.destinationBranchId) {
                    for (const line of voucher.lines) {
                        const qty = toNumber(line.quantity);
                        if (!(qty > 0)) continue;
                        const qInt = Math.round(qty);
                        await tx.invStockLedger.create({
                            data: { productId: line.productId, voucherId: voucher.id, branchId: voucher.branchId, date: new Date(), inQty: qty, outQty: 0, rate: line.rate, amount: -toNumber(line.amount) },
                        });
                        await tx.invProductBranch.upsert({
                            where:  { productId_branchId: { productId: line.productId, branchId: voucher.branchId } },
                            create: { productId: line.productId, branchId: voucher.branchId, stock: qInt },
                            update: { stock: { increment: qInt } },
                        });
                        await tx.invStockLedger.create({
                            data: { productId: line.productId, voucherId: voucher.id, branchId: voucher.destinationBranchId, date: new Date(), inQty: 0, outQty: qty, rate: line.rate, amount: -toNumber(line.amount) },
                        });
                        await tx.invProductBranch.upsert({
                            where:  { productId_branchId: { productId: line.productId, branchId: voucher.destinationBranchId } },
                            create: { productId: line.productId, branchId: voucher.destinationBranchId, stock: -qInt },
                            update: { stock: { decrement: qInt } },
                        });
                    }
                } else {
                for (const line of voucher.lines) {
                    const qty = toNumber(line.quantity);
                    await tx.invStockLedger.create({
                        data: {
                            productId: line.productId,
                            voucherId: voucher.id,
                            branchId:  voucher.branchId,
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
                    if (isPurchase || isSale) {
                        await tx.invProductBranch.upsert({
                            where:  { productId_branchId: { productId: line.productId, branchId: voucher.branchId } },
                            create: { productId: line.productId, branchId: voucher.branchId, stock: isPurchase ? -Math.round(qty) : Math.round(qty) },
                            update: { stock: isPurchase ? { decrement: Math.round(qty) } : { increment: Math.round(qty) } },
                        });
                    }
                }
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
