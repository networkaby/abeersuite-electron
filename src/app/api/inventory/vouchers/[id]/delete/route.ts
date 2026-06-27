import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { toNumber, balanceDelta } from "@/modules/accountancy/lib/balance";
import { setSpineLifecycle } from "@/modules/accountancy/lib/transactionEngine";
import { recordStockMovement, reverseStockMovement } from "@/modules/inventory/lib/stockMovement";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import { ensureDeletable, deleteFields, isPosted, lifecycleErrorResponse } from "@/modules/accountancy/lib/voucherLifecycle";
import * as Sentry from "@sentry/nextjs";
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
    // POS = counter sale: moves stock OUT like SALE, so reversing must restore it.
    // Omitting POS left the GL reversed but stock un-restored → inventory (a
    // Balance-Sheet asset) came out wrong.
    const isSale     = voucher.type === "SALE"     || voucher.type === "POS" || voucher.type === "CHALLAN";
    const isBranchTransfer = voucher.type === "BRANCH_TRANSFER";
    const isLedgerMirror = voucher.type === "PHYSICAL_STOCK" || voucher.type === "MANUFACTURING_JOURNAL";

    try {
        ensureDeletable(voucher);

        await prisma.$transaction(async (tx) => {
            if (isPosted(voucher)) {
                // Reverse stock + cached balance — same shape as cancel, but no counter-entry written.
                const now = new Date();
                if (isLedgerMirror) {
                    // Mirror the original ledger rows in reverse via the helper.
                    const origRows = await tx.invStockLedger.findMany({
                        where:  { voucherId: voucher.id, amount: { gte: 0 } },
                        select: { id: true, productId: true, branchId: true, voucherId: true, inQty: true, outQty: true, rate: true, amount: true },
                    });
                    for (const row of origRows) {
                        await reverseStockMovement(tx, { ledgerRow: row, reversalDate: now });
                    }
                } else if (isBranchTransfer && voucher.destinationBranchId) {
                    for (const line of voucher.lines) {
                        const qty = toNumber(line.quantity);
                        if (!(qty > 0)) continue;
                        await recordStockMovement(tx, {
                            voucherId: voucher.id,
                            productId: line.productId,
                            branchId:  voucher.branchId,
                            date:      now,
                            inQty:     qty,
                            outQty:    0,
                            rate:      line.rate,
                            amount:    -toNumber(line.amount),
                            updateOrgWideStock: false,
                        });
                        await recordStockMovement(tx, {
                            voucherId: voucher.id,
                            productId: line.productId,
                            branchId:  voucher.destinationBranchId,
                            date:      now,
                            inQty:     0,
                            outQty:    qty,
                            rate:      line.rate,
                            amount:    -toNumber(line.amount),
                            updateOrgWideStock: false,
                        });
                    }
                } else {
                    for (const line of voucher.lines) {
                        const qty = toNumber(line.quantity);
                        // Non-sale, non-purchase types still write a zero-qty
                        // audit row; the helper's delta === 0 guard skips the
                        // cache updates.
                        await recordStockMovement(tx, {
                            voucherId: voucher.id,
                            productId: line.productId,
                            branchId:  voucher.branchId,
                            date:      now,
                            inQty:     isSale     ? qty : 0,
                            outQty:    isPurchase ? qty : 0,
                            rate:      line.rate,
                            amount:    -toNumber(line.amount),
                            updateBranchBalance: isPurchase || isSale,
                        });
                    }
                }

                if (voucher.journalEntryId) {
                    const spine = await tx.universalVoucher.findUnique({
                        where:  { id: voucher.journalEntryId },
                        select: { status: true, deletedAt: true, lines: { select: { accountId: true, type: true, amount: true } } },
                    });
                    if (spine && spine.status === "POSTED" && !spine.deletedAt) {
                        const accIds = [...new Set(spine.lines.map((l) => l.accountId))];
                        const nbById = new Map(
                            (await tx.account.findMany({ where: { id: { in: accIds } }, select: { id: true, normalBalance: true } }))
                                .map((a) => [a.id, a.normalBalance]),
                        );
                        for (const line of spine.lines) {
                            const delta = balanceDelta(nbById.get(line.accountId)!, line.type, toNumber(line.amount));
                            await tx.account.update({ where: { id: line.accountId }, data: { balance: { decrement: delta } } });
                        }
                        await setSpineLifecycle(tx, voucher.journalEntryId, {
                            deletedAt: new Date(), deletedById: user!.id,
                            deleteReason: `Voucher ${voucher.reference} deleted: ${data.reason}`,
                        });
                    }
                }
            }

            await tx.invVoucher.update({
                where: { id: Number(id) },
                data: deleteFields(user!.id, data.reason),
            });
        // Reverse stock + GL over the Supabase pooler can exceed the default
        // 5s interactive-tx ceiling (P2028) — match the 30s headroom used by
        // the post/PATCH routes.
        }, { timeout: 30_000, maxWait: 10_000 });

        if (isPosted(voucher)) {
            const touchedProductIds = voucher.lines.map((l) => l.productId);
            await recomputePricesForProducts(touchedProductIds).catch((err: unknown) => {
                Sentry.captureException(err, { tags: { source: "price-recompute", voucherId: String(voucher.id) } });
                console.error("[price-recompute] failed for voucher", voucher.id, err);
            });
        }

        const updated = await prisma.invVoucher.findUnique({ where: { id: Number(id) } });
        return NextResponse.json(updated);
    } catch (e) {
        const lifecycle = lifecycleErrorResponse(e);
        if (lifecycle) return lifecycle;
        return handleApiError(e, "Failed to delete voucher");
    }
}
