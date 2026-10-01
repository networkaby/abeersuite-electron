import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { after } from "next/server";
import { requireAuth, userCanActOnVoucher } from "@/shared/lib/auth/permissions";
import { applyLineBalances, toNumber } from "@/modules/accountancy/lib/balance";
import { setSpineLifecycle } from "@/modules/accountancy/lib/transactionEngine";
import { reverseStockMovement, recomputeProductStock } from "@/modules/inventory/lib/stockMovement";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import { ensureCancelable, lifecycleErrorResponse } from "@/modules/accountancy/lib/voucherLifecycle";
import { reverseCouponRedemption, refundGiftCard } from "@/modules/coupons/lib";
import { reverseLoyaltyForReturn, ratesFromConfig } from "@/modules/loyalty/lib";
import * as Sentry from "@sentry/nextjs";
import { handleApiError } from "@/shared/lib/api";

// POST /api/inventory/vouchers/[id]/cancel
// Reverses stock + GL impact via counter-entry; preserves voucher reference number.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response, user } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const { reason } = (await req.json()) as { reason?: string };
    if (!reason?.trim()) return NextResponse.json({ error: "Cancel reason required" }, { status: 400 });

    const userId = user!.id;

    const voucherRow = await prisma.voucherDetail.findUnique({ where: { id: Number(id) }, include: { universalVoucher: { select: { voucherNo: true, status: true, type: true, branchId: true, partyAccountId: true } } } });   // 5D-6/5D-8/5D-11/5D-12 + 5D-4 party (loyalty reversal)
    if (!voucherRow) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Phase 5 5C: goods lines hang off the spine — load + attach as `voucher.lines`.
    const goodsLines = await prisma.voucherInventoryLine.findMany({
        where:   { universalVoucherId: voucherRow.universalVoucherId ?? -1 },
        include: { product: { select: { id: true } } },
    });
    // 5D-8/5D-11/5D-12: status + type + branch live on the spine — attach for the helpers + guards + stock rows.
    const voucher = { ...voucherRow, lines: goodsLines, type: voucherRow.universalVoucher?.type ?? "", branchId: voucherRow.universalVoucher?.branchId ?? "", status: voucherRow.universalVoucher?.status ?? "DRAFT" };

    // Per-kind cancel gate. Office kinds need their matrix cancel key; POS Sale /
    // Order / Estimate need their POS-table Cancel / edit tick; online orders and
    // invoices pass through (gated by their own flow).
    if (!userCanActOnVoucher(user, voucher.type, "cancel")) {
        return NextResponse.json({ error: "You do not have permission to cancel this voucher kind." }, { status: 403 });
    }

    try {
        ensureCancelable(voucher);

        await prisma.$transaction(async (tx) => {
            // ── 1. Reverse stock ledger + cached InvProduct.stock ─────────────
            // MIRROR whatever this voucher actually wrote — one counter-entry per
            // original row — instead of re-deriving the direction from the type.
            // The old code kept three hand-maintained type lists (sale / purchase /
            // ledger-mirror / branch-transfer) that had drifted out of step with the
            // posting path: SALE_RETURN (every POS return), PURCHASE_RETURN,
            // REJECTION_IN/OUT and ONLINE_INVOICE all moved stock on post but matched
            // NO list here, so cancel reversed the GL and silently left the stock
            // wrong. It also reversed `quantity` only, leaking `freeQty` units.
            // Mirroring is immune to both: it cannot disagree with what was posted,
            // and it covers PHYSICAL_STOCK / MANUFACTURING_JOURNAL / BRANCH_TRANSFER
            // (whose two rows net to zero org-wide) without special cases.
            //
            // Only ORIGINAL rows — a counter-entry names the row it reverses
            // (`reversalOfId`), so a re-run can never reverse a reversal, ₹0 lines included.
            const origRows = await tx.invStockLedger.findMany({
                where:  { universalVoucherId: voucher.universalVoucherId ?? -1, reversalOfId: null },
                select: { id: true, productId: true, branchId: true, universalVoucherId: true, inQty: true, outQty: true, rate: true, amount: true },
            });
            const now = new Date();
            for (const row of origRows) {
                await reverseStockMovement(tx, { ledgerRow: row, reversalDate: now });
            }
            // Rebuild the caches from the ledger rather than trusting the
            // increment/decrement deltas just applied (same safety net the
            // in-place edit path uses).
            await recomputeProductStock(tx, origRows.map((r) => r.productId));

            // ── 2. Reverse the spine GL posting if one was created (G5) ────────
            if (voucher.universalVoucherId) {
                const spine = await tx.universalVoucher.findUnique({
                    where:  { id: voucher.universalVoucherId },
                    select: { status: true, lines: { select: { accountId: true, type: true, amount: true } } },
                });
                if (spine && spine.status === "POSTED") {
                    // Reverse the cached Account.balance, then mark the spine CANCELLED so
                    // the truth path (Balance Sheet / ledgers) drops it. No counter-entry.
                    // Nature must resolve exactly as the engine resolved it on post
                    // (group fallback included). The old `!` here fed `null` into
                    // balanceDelta, which fails `=== "DEBIT"` and silently reverses
                    // a null-nature ledger on the CREDIT side — a sign flip, not a
                    // no-op. Skip a line whose nature is genuinely unknown instead.
                    await applyLineBalances(tx, spine.lines, "reverse");
                    await setSpineLifecycle(tx, voucher.universalVoucherId, {
                        status: "CANCELLED", cancelledAt: new Date(), cancelledById: userId,
                        cancelReason: `Voucher ${voucher.universalVoucher?.voucherNo ?? ""} cancelled: ${reason.trim()}`,
                    });
                }
            }

            // ── 2b. Reverse the rewards the sale consumed ──────────────────────
            // Cancel used to reverse stock and the GL and stop there: the gift card
            // stayed drawn, the coupon stayed used and the loyalty lots stayed
            // credited/consumed. The customer lost card value with no ledger behind
            // it and the coupon was burnt on a sale that no longer exists (audit C2).
            // Every helper below no-ops when the sale carried nothing of its kind, so
            // this runs for all voucher kinds without a per-kind branch.
            if (voucher.universalVoucherId) {
                const spineId = voucher.universalVoucherId;

                // Gift card — put back exactly what this sale drew. A REFUND row
                // against the same spine means an earlier pass already did it.
                const draws = await tx.giftCardTxn.findMany({
                    where:  { universalVoucherId: spineId, type: "REDEEM" },
                    select: { giftCardId: true, amount: true },
                });
                if (draws.length > 0) {
                    const refunded = await tx.giftCardTxn.findMany({
                        where:  { universalVoucherId: spineId, type: "REFUND" },
                        select: { giftCardId: true },
                    });
                    const alreadyRefunded = new Set(refunded.map((r) => r.giftCardId));
                    for (const draw of draws) {
                        if (alreadyRefunded.has(draw.giftCardId)) continue;
                        const amount = Math.abs(toNumber(draw.amount));   // REDEEM is stored negative
                        if (amount <= 0.005) continue;
                        await refundGiftCard(tx, { giftCardId: draw.giftCardId, amount, universalVoucherId: spineId, createdById: userId });
                    }
                }

                // Coupon — free the usage slot. Idempotent on its own `reversedAt: null`.
                await reverseCouponRedemption(tx, { originalUniversalVoucherId: spineId, returnFraction: 1 });

                // Loyalty — a cancel is a full return with no credit note, so the sale's
                // own spine carries the reversal rows. The claw-back is capped at the
                // earn lot's remaining points and the restore at the original redeem net
                // of what earlier partial returns already gave back, so a sale returned
                // in part and then cancelled reverses once, never twice.
                const partyAccountId = voucher.universalVoucher?.partyAccountId ?? null;
                if (partyAccountId != null) {
                    const loyaltyConfig = await tx.loyaltyConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
                    await reverseLoyaltyForReturn(tx, {
                        accountId:                  partyAccountId,
                        originalUniversalVoucherId: spineId,
                        originalVoucherId:          voucher.id,
                        returnUniversalVoucherId:   spineId,
                        returnVoucherId:            voucher.id,
                        returnFraction:             1,
                        rates:                      ratesFromConfig(loyaltyConfig),
                        createdById:                userId,
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
        // Pricing-cache refresh is not part of this answer - defer it past the
        // response with after() (reliable on serverless, unlike a bare
        // fire-and-forget) so nobody waits on a cost-ledger walk.
        after(async () => {
            await recomputePricesForProducts(touchedProductIds).catch((err: unknown) => {
                Sentry.captureException(err, { tags: { source: "price-recompute", voucherId: String(voucher.id) } });
                console.error("[price-recompute] failed for voucher", voucher.id, err);
            });
        });

        const updatedRow = await prisma.voucherDetail.findUnique({
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
