// In-place re-apply for an EDITED, already-POSTED trading voucher (Phase 4 ②).
//
// The decided edit model: an edit keeps the SAME voucher AND the same GL entry —
// we rewrite the JE's lines in place (so receipts allocated against its
// journalEntryId stay linked), rewrite the stock rows, and rebuild the cached
// Account.balance / InvProduct.stock from truth (recompute, not reverse+reapply).
//
// Called by the inventory-voucher PATCH route AFTER it has snapshotted the old
// state to AuditLog and written the new voucher lines/charges/tenders/header.
// The exact sequence here is proven by the parity harness `runEditCycle`.
//
// ORDER MATTERS: rewrite spine GL lines → recomputeAccountBalances
// (it reads the spine); stock rows → recomputeProductStock.

import type { Prisma } from "@/generated/prisma/client";
import { saleToSpec, type TradingStockLine } from "./voucherMappers";
import type { PostVoucherInput } from "./postInvVoucher";
import { recomputeAccountBalances } from "./aggregateLedger";
import { recordStockMovement, recomputeProductStock } from "@/modules/inventory/lib/stockMovement";

export async function reapplyTradingVoucherInPlace(
    tx: Prisma.TransactionClient,
    args: {
        /// The edited voucher (post-edit values), loaded with the fields saleToSpec needs.
        voucher:        PostVoucherInput["voucher"];
        /// Source branch — stamped on the stock moves.
        branchId:       string;
        /// Edited item lines (drive the stock arm).
        lines:          TradingStockLine[];
        /// The EXISTING JE to rewrite in place (kept — never re-minted). Null for
        /// stock-only trading types (GRN/CHALLAN/REJECTION) that never had a JE.
        journalEntryId: number | null;
    },
): Promise<number | null> {
    const { voucher, branchId, lines, journalEntryId } = args;

    // Recompute the spec (GL lines + stock moves) from the edited voucher.
    const spec = await saleToSpec(tx, voucher, { voucherId: voucher.id, branchId, lines });

    // ── GL: rewrite the spine lines on the SAME UniversalVoucher id ───────────
    // `journalEntryId` carries the spine id (self-ref since G5); receipts
    // allocated against it stay linked because we keep the same header.
    if (journalEntryId != null && spec.glLines.length > 0) {
        const oldAccountIds = (await tx.voucherGlLine.findMany({
            where:  { universalVoucherId: journalEntryId },
            select: { accountId: true },
        })).map((l) => l.accountId);

        await tx.voucherGlLine.deleteMany({ where: { universalVoucherId: journalEntryId } });
        await tx.voucherGlLine.createMany({
            data: spec.glLines.map((l, idx) => ({
                universalVoucherId: journalEntryId,
                accountId:   l.accountId,
                type:        l.type,
                amount:      l.amount,
                description: l.description ?? null,
                seq:         idx,
            })),
        });

        await recomputeAccountBalances(tx, [...new Set([...oldAccountIds, ...spec.glLines.map((l) => l.accountId)])]);
    }

    // ── Stock: replace this voucher's ledger rows, then recompute on-hand ─────
    await tx.invStockLedger.deleteMany({ where: { voucherId: voucher.id } });
    for (const move of spec.stockMoves) await recordStockMovement(tx, move);
    await recomputeProductStock(tx, [...new Set(spec.stockMoves.map((m) => m.productId))]);

    return journalEntryId;
}
