import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { toNumber, nextRefFromSeries } from "@/modules/accountancy/lib/balance";
import { ensureCancelable, cancelFields, lifecycleErrorResponse } from "@/modules/accountancy/lib/voucherLifecycle";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// POST /api/inventory/vouchers/[id]/cancel
// Reverses stock + GL impact via counter-entry; preserves voucher reference number.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response, user } = await requirePermission(PERMISSIONS.INVENTORY_VOUCHER_CANCEL);
    if (response) return response;

    const { id } = await params;
    const { reason } = (await req.json()) as { reason?: string };
    if (!reason?.trim()) return NextResponse.json({ error: "Cancel reason required" }, { status: 400 });

    const userId = user!.id;

    const voucher = await prisma.invVoucher.findUnique({
        where: { id: Number(id) },
        include: { lines: { include: { product: { select: { id: true } } } } },
    });

    if (!voucher) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const isPurchase = voucher.type === "PURCHASE" || voucher.type === "GRN";
    const isSale     = voucher.type === "SALE"     || voucher.type === "CHALLAN";
    const isBranchTransfer = voucher.type === "BRANCH_TRANSFER";
    // Voucher types whose stock impact is computed at post-time (per-line
    // delta vs running stock), not driven by a fixed in/out direction.
    // For these, the cancel reversal must mirror the original ledger rows
    // so we don't have to recompute what the post wrote.
    const isLedgerMirror = voucher.type === "PHYSICAL_STOCK" || voucher.type === "MANUFACTURING_JOURNAL";

    try {
        ensureCancelable(voucher);

        await prisma.$transaction(async (tx) => {
            // ── 1. Reverse stock ledger + cached InvProduct.stock ─────────────
            if (isLedgerMirror) {
                // Generic reversal — look up the InvStockLedger rows the
                // original post wrote against this voucher, append counter-
                // entries (in↔out swapped, amount sign flipped), and patch
                // both InvProduct.stock and InvProductBranch.stock by the
                // same net delta. Works regardless of the per-line direction
                // logic used at post time.
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
                    // Net delta on this branch from the original row:
                    //   originalDelta = inQty − outQty (positive when stock went UP)
                    // Reversal applies the opposite sign.
                    const originalDelta = Math.round(inN - outN);
                    if (originalDelta !== 0) {
                        const reverseDelta = -originalDelta;
                        await tx.invProductBranch.upsert({
                            where:  { productId_branchId: { productId: row.productId, branchId: row.branchId } },
                            create: { productId: row.productId, branchId: row.branchId, stock: reverseDelta },
                            update: { stock: reverseDelta > 0 ? { increment: reverseDelta } : { decrement: -reverseDelta } },
                        });
                        // Also patch the org-wide cache so it stays in sync
                        // with the sum of per-branch rows.
                        await tx.invProduct.update({
                            where: { id: row.productId },
                            data:  { stock: reverseDelta > 0 ? { increment: reverseDelta } : { decrement: -reverseDelta } },
                        });
                    }
                }
            } else if (isBranchTransfer && voucher.destinationBranchId) {
                // Reverse both sides: put units back on source, take them off dest.
                for (const line of voucher.lines) {
                    const qty  = toNumber(line.quantity);
                    if (!(qty > 0)) continue;
                    const qInt = Math.round(qty);

                    await tx.invStockLedger.create({
                        data: {
                            productId: line.productId,
                            voucherId: voucher.id,
                            branchId:  voucher.branchId,
                            date:      new Date(),
                            inQty:     qty,
                            outQty:    0,
                            rate:      line.rate,
                            amount:    -toNumber(line.amount),
                        },
                    });
                    await tx.invProductBranch.upsert({
                        where:  { productId_branchId: { productId: line.productId, branchId: voucher.branchId } },
                        create: { productId: line.productId, branchId: voucher.branchId, stock: qInt },
                        update: { stock: { increment: qInt } },
                    });

                    await tx.invStockLedger.create({
                        data: {
                            productId: line.productId,
                            voucherId: voucher.id,
                            branchId:  voucher.destinationBranchId,
                            date:      new Date(),
                            inQty:     0,
                            outQty:    qty,
                            rate:      line.rate,
                            amount:    -toNumber(line.amount),
                        },
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

            // ── 2. Reverse GL Journal Entry if one was created ────────────────
            if (voucher.journalEntryId) {
                const origJe = await tx.journalEntry.findUnique({
                    where: { id: voucher.journalEntryId },
                    include: { lines: { include: { account: { select: { normalBalance: true } } } } },
                });

                if (origJe && origJe.status === "POSTED") {
                    const ref = await nextRefFromSeries(tx, "GL_POSTING", userId);

                    const reversalLines = origJe.lines.map((l) => ({
                        accountId:   l.accountId,
                        type:        (l.type === "DEBIT" ? "CREDIT" : "DEBIT") as "DEBIT" | "CREDIT",
                        amount:      toNumber(l.amount),
                        description: `CANCEL: ${l.description ?? ""}`,
                    }));

                    const revJe = await tx.journalEntry.create({
                        data: {
                            date:        new Date(),
                            reference:   ref,
                            description: `CANCEL: ${origJe.description}`,
                            status:      "POSTED",
                            postedAt:    new Date(),
                            createdById: userId,
                            lines:       { create: reversalLines },
                        },
                    });

                    for (const rl of reversalLines) {
                        const origLine = origJe.lines.find((l) => l.accountId === rl.accountId)!;
                        const delta = origLine.account.normalBalance === "DEBIT"
                            ? (rl.type === "DEBIT" ? rl.amount : -rl.amount)
                            : (rl.type === "CREDIT" ? rl.amount : -rl.amount);
                        await tx.account.update({
                            where: { id: rl.accountId },
                            data:  { balance: { increment: delta } },
                        });
                    }

                    await tx.journalEntry.update({
                        where: { id: origJe.id },
                        data:  {
                            status: "CANCELLED",
                            cancelledAt: new Date(),
                            cancelledById: userId,
                            cancelReason: `Voucher ${voucher.reference} cancelled. Reversal: ${revJe.reference}`,
                        },
                    });
                }
            }

            // ── 3. Mark voucher as CANCELLED ──────────────────────────────────
            await tx.invVoucher.update({
                where: { id: voucher.id },
                data:  cancelFields(userId, reason.trim()),
            });
        });

        const updated = await prisma.invVoucher.findUnique({
            where: { id: Number(id) },
            include: {
                lines: { include: { product: { select: { id: true, sku: true, name: true } } } },
                createdBy: { select: { name: true } },
            },
        });
        return NextResponse.json(updated);
    } catch (e) {
        const lifecycle = lifecycleErrorResponse(e);
        if (lifecycle) return lifecycle;
        return handleApiError(e, "Failed to cancel voucher");
    }
}
