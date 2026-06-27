import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { toNumber, balanceDelta } from "@/modules/accountancy/lib/balance";
import { setSpineLifecycle } from "@/modules/accountancy/lib/transactionEngine";
import { recordStockMovement } from "@/modules/inventory/lib/stockMovement";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import { ensureRestorable, restoreFields, isPosted, lifecycleErrorResponse } from "@/modules/accountancy/lib/voucherLifecycle";
import * as Sentry from "@sentry/nextjs";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// POST /api/inventory/vouchers/[id]/restore
// Inverse of delete — re-applies stock + GL impact if the voucher was posted.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response, user } = await requirePermission(PERMISSIONS.INVENTORY_VOUCHER_DELETE);
    if (response) return response;

    const { id } = await params;
    const voucherRow = await prisma.invVoucher.findUnique({ where: { id: Number(id) } });
    if (!voucherRow) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Phase 5 5C: goods lines hang off the spine.
    const goodsLines = await prisma.voucherInventoryLine.findMany({
        where: { universalVoucherId: voucherRow.universalVoucherId ?? -1 },
    });
    const voucher = { ...voucherRow, lines: goodsLines };

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
                        universalVoucherId: voucher.universalVoucherId!,
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

                if (voucher.universalVoucherId) {
                    const spine = await tx.universalVoucher.findUnique({
                        where:  { id: voucher.universalVoucherId },
                        select: { deletedAt: true, lines: { select: { accountId: true, type: true, amount: true } } },
                    });
                    if (spine && spine.deletedAt) {
                        const accIds = [...new Set(spine.lines.map((l) => l.accountId))];
                        const nbById = new Map(
                            (await tx.account.findMany({ where: { id: { in: accIds } }, select: { id: true, normalBalance: true } }))
                                .map((a) => [a.id, a.normalBalance]),
                        );
                        for (const line of spine.lines) {
                            const delta = balanceDelta(nbById.get(line.accountId)!, line.type, toNumber(line.amount));
                            await tx.account.update({ where: { id: line.accountId }, data: { balance: { increment: delta } } });
                        }
                        await setSpineLifecycle(tx, voucher.universalVoucherId, { deletedAt: null, deletedById: null, deleteReason: null });
                    }
                }
            }

            // Phase 5 5.0d: undelete the DRAFT voucher's draft spine alongside it
            // (POSTED spines handled in the isPosted block above).
            if (!isPosted(voucher) && voucher.universalVoucherId) {
                await setSpineLifecycle(tx, voucher.universalVoucherId, { deletedAt: null, deletedById: null, deleteReason: null });
            }

            await tx.invVoucher.update({
                where: { id: Number(id) },
                data: restoreFields(),
            });
            void user;
        // Re-post stock + GL over the Supabase pooler can exceed the default
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

        const restored = await prisma.invVoucher.findUnique({ where: { id: Number(id) } });
        return NextResponse.json(restored);
    } catch (e) {
        const lifecycle = lifecycleErrorResponse(e);
        if (lifecycle) return lifecycle;
        return handleApiError(e, "Failed to restore voucher");
    }
}
