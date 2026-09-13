import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, userCanVoucherKind } from "@/shared/lib/auth/permissions";
import { toNumber, balanceDelta, loadNormalBalances } from "@/modules/accountancy/lib/balance";
import { setSpineLifecycle } from "@/modules/accountancy/lib/transactionEngine";
import { deleteCancelCounterRows, recomputeProductStock } from "@/modules/inventory/lib/stockMovement";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import { ensureRestorable, lifecycleErrorResponse } from "@/modules/accountancy/lib/voucherLifecycle";
import { writeRestoreAudit } from "@/modules/accountancy/lib/restoreAudit";
import { findRestoreConflicts } from "@/modules/accountancy/lib/restoreConflicts";
import { restoreCouponRedemption, undoGiftCardRefundForVoucher } from "@/modules/coupons/lib";
import { restoreLoyaltyAfterCancel, ratesFromConfig } from "@/modules/loyalty/lib";
import * as Sentry from "@sentry/nextjs";
import { handleApiError } from "@/shared/lib/api";

// POST /api/inventory/vouchers/[id]/restore
// Un-cancel: puts the voucher back exactly as it stood before the cancel — stock,
// GL, gift card, coupon and loyalty. Every step is the mirror of the matching step
// in the cancel route, walked in reverse order, and each one deletes the rows
// cancel wrote rather than posting a fresh correction, so a cancel→restore→cancel
// cycle reverses once each time instead of stacking.
//
// Nothing is permanently blocked, but the caller is WARNED first: a gift card may
// have been spent since the cancel and a freed coupon slot may have been taken, so
// taking them back can leave a card, coupon or points balance short. Those are
// reported as a 409 + `conflicts` list; the UI shows them and re-sends with
// `force: true` when the user says go ahead. The office adjusts afterwards — the
// voucher's own truth comes first.
//
// The one thing that DOES abort outright is an unreadable stock trail, because
// guessing there corrupts stock silently.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response, user } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const { reason, force } = (await req.json()) as { reason?: string; force?: boolean };
    if (!reason?.trim()) return NextResponse.json({ error: "Restore reason required" }, { status: 400 });

    const userId = user!.id;

    const voucherRow = await prisma.voucherDetail.findUnique({
        where:   { id: Number(id) },
        include: { universalVoucher: { select: { voucherNo: true, status: true, deletedAt: true, type: true, branchId: true, partyAccountId: true } } },
    });
    if (!voucherRow) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const voucher = {
        ...voucherRow,
        type:       voucherRow.universalVoucher?.type ?? "",
        status:     voucherRow.universalVoucher?.status ?? "DRAFT",
        deletedAt:  voucherRow.universalVoucher?.deletedAt ?? null,
    };

    // Same per-kind gate as cancel: whoever may cancel this kind may restore it.
    if (!userCanVoucherKind(user, voucher.type, "cancel")) {
        return NextResponse.json({ error: "You do not have permission to restore this voucher kind." }, { status: 403 });
    }

    try {
        ensureRestorable(voucher);

        const spineId = voucher.universalVoucherId;
        const partyAccountId = voucher.universalVoucher?.partyAccountId ?? null;

        // Warn before touching anything — unless the caller has already seen the
        // warning and said go ahead.
        if (spineId && !force) {
            const conflicts = await findRestoreConflicts(prisma, { universalVoucherId: spineId, partyAccountId });
            if (conflicts.length > 0) {
                return NextResponse.json({ error: "Restore needs confirmation", conflicts }, { status: 409 });
            }
        }

        let touchedProductIds: number[] = [];

        await prisma.$transaction(async (tx) => {
            // ── 1. Take back the rewards the cancel handed out ─────────────────
            if (spineId) {
                await undoGiftCardRefundForVoucher(tx, { universalVoucherId: spineId });
                await restoreCouponRedemption(tx, { originalUniversalVoucherId: spineId });

                if (partyAccountId != null) {
                    const loyaltyConfig = await tx.loyaltyConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
                    await restoreLoyaltyAfterCancel(tx, {
                        accountId:          partyAccountId,
                        universalVoucherId: spineId,
                        rates:              ratesFromConfig(loyaltyConfig),
                    });
                }

                // ── 2. Re-apply the GL posting the cancel reversed ─────────────
                // `ensureRestorable` above already proved the spine is CANCELLED, so
                // the flip is unconditional — gating it on a re-read would let a
                // surprise leave the voucher CANCELLED with its stock already given
                // back, which is worse than either outcome on its own.
                const spine = await tx.universalVoucher.findUnique({
                    where:  { id: spineId },
                    select: { lines: { select: { accountId: true, type: true, amount: true } } },
                });
                if (spine) {
                    // Resolve nature exactly as cancel resolved it (group fallback
                    // included) and skip a genuinely unknown one, so the two sides
                    // touch the same set of ledgers and can never drift.
                    const nbById = await loadNormalBalances(tx, spine.lines.map((l) => l.accountId));
                    for (const line of spine.lines) {
                        const nb = nbById.get(line.accountId);
                        if (!nb) continue;
                        const delta = balanceDelta(nb, line.type, toNumber(line.amount));
                        await tx.account.update({ where: { id: line.accountId }, data: { balance: { increment: delta } } });
                    }
                    await setSpineLifecycle(tx, spineId, {
                        status: "POSTED", cancelledAt: null, cancelledById: null, cancelReason: null,
                    });
                }

                // ── 3. Drop the stock counter-entries, rebuild the caches ──────
                touchedProductIds = await deleteCancelCounterRows(tx, spineId);
                await recomputeProductStock(tx, touchedProductIds);
            }
        // Same 30s headroom as cancel — the per-line round-trip chain overruns the
        // default 5s interactive-tx ceiling over the Supabase pooler (P2028).
        }, { timeout: 30_000, maxWait: 10_000 });

        await recomputePricesForProducts(touchedProductIds).catch((err: unknown) => {
            Sentry.captureException(err, { tags: { source: "price-recompute", voucherId: String(voucher.id) } });
            console.error("[price-recompute] failed for voucher", voucher.id, err);
        });

        await writeRestoreAudit({
            entityType: "INV_VOUCHER", subtype: voucher.type, originalId: voucher.id,
            originalRef: voucher.universalVoucher?.voucherNo ?? String(voucher.id),
            reason: reason.trim(), actorId: userId,
        });

        const updatedRow = await prisma.voucherDetail.findUnique({
            where:   { id: Number(id) },
            include: { universalVoucher: { select: { createdById: true } } },
        });
        const creator = updatedRow?.universalVoucher?.createdById != null
            ? await prisma.user.findUnique({ where: { id: updatedRow.universalVoucher.createdById }, select: { name: true } })
            : null;
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
        return handleApiError(e, "Failed to restore voucher");
    }
}
