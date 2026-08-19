import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, userCanVoucherKind } from "@/shared/lib/auth/permissions";
import { toNumber, balanceDelta, loadNormalBalances } from "@/modules/accountancy/lib/balance";
import { setSpineLifecycle } from "@/modules/accountancy/lib/transactionEngine";
import { reverseStockMovement, recomputeProductStock } from "@/modules/inventory/lib/stockMovement";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import { ensureCancelable, lifecycleErrorResponse } from "@/modules/accountancy/lib/voucherLifecycle";
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

    const voucherRow = await prisma.voucherDetail.findUnique({ where: { id: Number(id) }, include: { universalVoucher: { select: { voucherNo: true, status: true, deletedAt: true, type: true, branchId: true } } } });   // 5D-6/5D-8/5D-11/5D-12
    if (!voucherRow) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Phase 5 5C: goods lines hang off the spine — load + attach as `voucher.lines`.
    const goodsLines = await prisma.voucherInventoryLine.findMany({
        where:   { universalVoucherId: voucherRow.universalVoucherId ?? -1 },
        include: { product: { select: { id: true } } },
    });
    // 5D-8/5D-11/5D-12: status/deletedAt + type + branch live on the spine — attach for the helpers + guards + stock rows.
    const voucher = { ...voucherRow, lines: goodsLines, type: voucherRow.universalVoucher?.type ?? "", branchId: voucherRow.universalVoucher?.branchId ?? "", status: voucherRow.universalVoucher?.status ?? "DRAFT", deletedAt: voucherRow.universalVoucher?.deletedAt ?? null };

    // Per-kind cancel gate. Kinds WITH a matrix row need their cancel key; the
    // channel kinds (POS, POS_ORDER, ONLINE_ORDER, ONLINE_INVOICE) have no row
    // and pass through — they are gated by their channel, not by the voucher
    // matrix. Same helper the create / post routes use, so all four lifecycle
    // actions treat the channel kinds identically.
    if (!userCanVoucherKind(user, voucher.type, "cancel")) {
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
            // `amount >= 0` selects the ORIGINAL rows — counter-entries carry a
            // negated amount, so a re-run can never reverse a reversal.
            const origRows = await tx.invStockLedger.findMany({
                where:  { universalVoucherId: voucher.universalVoucherId ?? -1, amount: { gte: 0 } },
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
                    const nbById = await loadNormalBalances(tx, spine.lines.map((l) => l.accountId));
                    for (const line of spine.lines) {
                        const nb = nbById.get(line.accountId);
                        if (!nb) continue;
                        const delta = balanceDelta(nb, line.type, toNumber(line.amount));
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
