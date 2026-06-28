import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { toNumber, balanceDelta } from "@/modules/accountancy/lib/balance";
import { setSpineLifecycle } from "@/modules/accountancy/lib/transactionEngine";
import { recordStockMovement, reverseStockMovement } from "@/modules/inventory/lib/stockMovement";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import { ensureCancelable, lifecycleErrorResponse } from "@/modules/accountancy/lib/voucherLifecycle";
import * as Sentry from "@sentry/nextjs";
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

    const voucherRow = await prisma.invVoucher.findUnique({ where: { id: Number(id) }, include: { universalVoucher: { select: { voucherNo: true, status: true, deletedAt: true } } } });   // 5D-6/5D-8
    if (!voucherRow) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Phase 5 5C: goods lines hang off the spine — load + attach as `voucher.lines`.
    const goodsLines = await prisma.voucherInventoryLine.findMany({
        where:   { universalVoucherId: voucherRow.universalVoucherId ?? -1 },
        include: { product: { select: { id: true } } },
    });
    // 5D-8: lifecycle status/deletedAt live on the spine — attach for the LifecycleVoucher helpers.
    const voucher = { ...voucherRow, lines: goodsLines, status: voucherRow.universalVoucher?.status ?? "DRAFT", deletedAt: voucherRow.universalVoucher?.deletedAt ?? null };

    const isPurchase = voucher.type === "PURCHASE" || voucher.type === "GRN";
    // POS = counter sale: it moves stock OUT like SALE, so reversing it must put
    // the stock back. Omitting POS here left the GL reversed but stock un-restored
    // → inventory (a Balance-Sheet asset) came out wrong.
    const isSale     = voucher.type === "SALE"     || voucher.type === "POS" || voucher.type === "CHALLAN";
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
                // original post wrote against this voucher and append counter-
                // entries via the shared helper. Works regardless of the per-
                // line direction logic used at post time.
                const origRows = await tx.invStockLedger.findMany({
                    where:  { universalVoucherId: voucher.universalVoucherId ?? -1, amount: { gte: 0 } },
                    select: { id: true, productId: true, branchId: true, universalVoucherId: true, inQty: true, outQty: true, rate: true, amount: true },
                });
                const now = new Date();
                for (const row of origRows) {
                    await reverseStockMovement(tx, { ledgerRow: row, reversalDate: now });
                }
            } else if (isBranchTransfer && voucher.destinationBranchId) {
                // Reverse both sides: put units back on source, take them off dest.
                const now = new Date();
                for (const line of voucher.lines) {
                    const qty  = toNumber(line.quantity);
                    if (!(qty > 0)) continue;

                    await recordStockMovement(tx, {
                        universalVoucherId: voucher.universalVoucherId!,
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
                        universalVoucherId: voucher.universalVoucherId!,
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
                const now = new Date();
                for (const line of voucher.lines) {
                    const qty = toNumber(line.quantity);

                    // Non-sale, non-purchase types (e.g. SALES_ORDER) still
                    // write a zero-qty audit row; the helper's delta === 0
                    // guard skips the cache updates.
                    await recordStockMovement(tx, {
                        universalVoucherId: voucher.universalVoucherId!,
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

            // ── 2. Reverse the spine GL posting if one was created (G5) ────────
            if (voucher.universalVoucherId) {
                const spine = await tx.universalVoucher.findUnique({
                    where:  { id: voucher.universalVoucherId },
                    select: { status: true, lines: { select: { accountId: true, type: true, amount: true } } },
                });
                if (spine && spine.status === "POSTED") {
                    // Reverse the cached Account.balance, then mark the spine CANCELLED so
                    // the truth path (Balance Sheet / ledgers) drops it. No counter-entry.
                    const accIds = [...new Set(spine.lines.map((l) => l.accountId))];
                    const nbById = new Map(
                        (await tx.account.findMany({ where: { id: { in: accIds } }, select: { id: true, normalBalance: true } }))
                            .map((a) => [a.id, a.normalBalance]),
                    );
                    for (const line of spine.lines) {
                        const delta = balanceDelta(nbById.get(line.accountId)!, line.type, toNumber(line.amount));
                        await tx.account.update({ where: { id: line.accountId }, data: { balance: { decrement: delta } } });
                    }
                    await setSpineLifecycle(tx, voucher.universalVoucherId, {
                        status: "CANCELLED", cancelledAt: new Date(), cancelledById: userId,
                        cancelReason: `Voucher ${voucher.universalVoucher?.voucherNo ?? ""} cancelled: ${reason.trim()}`,
                    });
                }
            }

            // ── 3. Cancellation is recorded ENTIRELY on the spine ─────────────
            // 5D-8: status + full cancel metadata (cancelledAt/By/Reason) live on
            // the spine (set in step 2). The detail carries no lifecycle flags now.
        // Reverse stock (per-line) + GL reversal (per-JE-line account.update)
        // is a long serial round-trip chain; over the Supabase pooler it
        // overruns the default 5s interactive-tx ceiling (P2028). Match the
        // 30s headroom used by the post/PATCH routes.
        }, { timeout: 30_000, maxWait: 10_000 });

        const touchedProductIds = voucher.lines.map((l) => l.productId);
        await recomputePricesForProducts(touchedProductIds).catch((err: unknown) => {
            Sentry.captureException(err, { tags: { source: "price-recompute", voucherId: String(voucher.id) } });
            console.error("[price-recompute] failed for voucher", voucher.id, err);
        });

        const updatedRow = await prisma.invVoucher.findUnique({
            where: { id: Number(id) },
            include: { universalVoucher: { select: { createdById: true } } },   // 5D-2: creator on spine
        });
        const creator = updatedRow?.universalVoucher?.createdById != null
            ? await prisma.user.findUnique({ where: { id: updatedRow.universalVoucher.createdById }, select: { name: true } })
            : null;
        // Phase 5 5C: goods lines hang off the spine.
        const updated = updatedRow ? {
            ...updatedRow,
            createdBy: creator,
            lines: await prisma.voucherInventoryLine.findMany({
                where:   { universalVoucherId: updatedRow.universalVoucherId ?? -1 },
                include: { product: { select: { id: true, sku: true, name: true } } },
            }),
        } : null;
        return NextResponse.json(updated);
    } catch (e) {
        const lifecycle = lifecycleErrorResponse(e);
        if (lifecycle) return lifecycle;
        return handleApiError(e, "Failed to cancel voucher");
    }
}
