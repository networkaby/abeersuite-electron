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
import { GlBuildError, type PostVoucherInput } from "./postInvVoucher";
import { recomputeAccountBalances } from "./aggregateLedger";
import { assertGlBalanced, glLineRow } from "./transactionEngine";
import { recordStockMovement, recomputeProductStock } from "@/modules/inventory/lib/stockMovement";
import { retreatReconciliation } from "./reconciliation";

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
        /// The voucher's date BEFORE this edit — the reconciliation lock retreats
        /// from the earlier of it and the edited date.
        previousDate:   Date;
    },
): Promise<number | null> {
    const { voucher, branchId, lines, journalEntryId, previousDate } = args;

    // Recompute the spec (GL lines + stock moves) from the edited voucher.
    const spec = await saleToSpec(tx, voucher, { branchId, lines });

    // A voucher that HAD a ledger entry must come out of an edit with one. If the
    // builder refused — the commonest reason being that the tenders no longer add
    // up to the edited total — this edit cannot be saved, because the alternative
    // is what used to happen: the lines and the header change, the GL silently
    // keeps the pre-edit figures, and the invoice and the books disagree for good.
    // Thrown inside the route's transaction, so nothing is written at all.
    if (spec.glSkipReason === "refused"
        || (journalEntryId != null && spec.glLines.length === 0
            && await tx.voucherGlLine.count({ where: { universalVoucherId: journalEntryId } }) > 0)) {
        const why = (spec.glNotes ?? []).join("; ");
        throw new GlBuildError(
            `This edit cannot be saved: the ledger entry could not be rebuilt${why ? ` — ${why}` : ""}. ` +
            "Check that the payment rows (cash, bank, or the party's own account for the unpaid part) " +
            "add up to the voucher total.",
        );
    }

    // ── GL: rewrite the spine lines on the SAME UniversalVoucher id ───────────
    // `journalEntryId` carries the spine id (self-ref since G5); receipts
    // allocated against it stay linked because we keep the same header.
    if (journalEntryId != null && spec.glLines.length > 0) {
        const oldAccountIds = (await tx.voucherGlLine.findMany({
            where:  { universalVoucherId: journalEntryId },
            select: { accountId: true },
        })).map((l) => l.accountId);

        assertGlBalanced(spec.glLines);
        await tx.voucherGlLine.deleteMany({ where: { universalVoucherId: journalEntryId } });
        // `glLineRow` — the SAME mapper the posting engine writes through. This
        // used to be a hand-written copy of five fields, which meant an edit threw
        // away `role`, `method`, `reference` and `branchId` every single time. A
        // dropped `role=TENDER` cannot be rebuilt from anything (a tag has no
        // ledger leg behind it), so one edit permanently convinced the counter
        // that a paid-in-cash bill was still owed. Rebuild through the mapper and
        // an edited voucher comes out byte-for-byte like a freshly posted one.
        await tx.voucherGlLine.createMany({
            data: spec.glLines.map((l, idx) => ({
                universalVoucherId: journalEntryId,
                ...glLineRow(l, idx, branchId),
            })),
        });

        const touched = [...new Set([...oldAccountIds, ...spec.glLines.map((l) => l.accountId)])];
        await recomputeAccountBalances(tx, touched);

        // A backdated edit dirties the reconciled window of every ledger it
        // touches — and the lines were just re-minted, so any bank tick on the
        // old ones is stale and must be re-made, which a frozen line cannot be.
        // Retreat from the earlier of the old and new dates, as every other
        // voucher edit does (see reconciliation.ts).
        const newDate = new Date(voucher.date);
        await retreatReconciliation(tx, touched, previousDate < newDate ? previousDate : newDate);
    }

    // ── Stock: replace this voucher's ledger rows, then recompute on-hand ─────
    // Phase 5 5C: stock hangs off the spine. `journalEntryId` carries the spine id
    // (self-ref since G5). Re-apply is only called for posted trading vouchers (JE present).
    const spineId = journalEntryId;
    if (spineId != null) {
        // Products on the OLD rows must be recomputed too. If the edit removed a
        // line (or swapped product A → B), A's ledger rows vanish here but A is
        // not in spec.stockMoves — without this its cached stock keeps the old
        // sale's decrement forever (phantom on-hand with no transactions).
        const oldProductIds = (await tx.invStockLedger.findMany({
            where:  { universalVoucherId: spineId },
            select: { productId: true },
        })).map((r) => r.productId);

        await tx.invStockLedger.deleteMany({ where: { universalVoucherId: spineId } });
        for (const move of spec.stockMoves) await recordStockMovement(tx, { ...move, universalVoucherId: spineId });
        await recomputeProductStock(tx, [...oldProductIds, ...spec.stockMoves.map((m) => m.productId)]);
    }

    return journalEntryId;
}
