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
// ORDER MATTERS: rewrite JE lines → resyncSpineFromJe → recomputeAccountBalances
// (it reads the spine); stock rows → recomputeProductStock.

import type { Prisma } from "@/generated/prisma/client";
import { saleToSpec, type TradingStockLine } from "./voucherMappers";
import type { PostVoucherInput } from "./postInvVoucher";
import { resyncSpineFromJe } from "./transactionEngine";
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

    // ── GL: rewrite the lines on the SAME JE id (allocation-safe) ─────────────
    if (journalEntryId != null && spec.glLines.length > 0) {
        const oldAccountIds = (await tx.journalLine.findMany({
            where:  { journalEntryId },
            select: { accountId: true },
        })).map((l) => l.accountId);

        await tx.journalLine.deleteMany({ where: { journalEntryId } });
        await tx.journalLine.createMany({
            data: spec.glLines.map((l) => ({
                journalEntryId,
                accountId:   l.accountId,
                type:        l.type,
                amount:      l.amount,
                description: l.description ?? null,
            })),
        });

        // Spine mirrors this JE; rebuild it before recomputing balances (which read it).
        await resyncSpineFromJe(tx, journalEntryId, { type: voucher.type, friendlyRef: voucher.reference });
        await recomputeAccountBalances(tx, [...new Set([...oldAccountIds, ...spec.glLines.map((l) => l.accountId)])]);
    }

    // ── Stock: replace this voucher's ledger rows, then recompute on-hand ─────
    await tx.invStockLedger.deleteMany({ where: { voucherId: voucher.id } });
    for (const move of spec.stockMoves) await recordStockMovement(tx, move);
    await recomputeProductStock(tx, [...new Set(spec.stockMoves.map((m) => m.productId))]);

    return journalEntryId;
}
