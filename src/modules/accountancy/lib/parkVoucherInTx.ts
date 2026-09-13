// Park a posted voucher back to DRAFT, repost it in place, or discard it —
// the "correct it, don't void it" path for SYSTEM-GENERATED vouchers.
//
// Cancel exists for a voucher that happened and must be undone: it keeps the row
// visible, CANCELLED, forever. That is right for anything a human raised and a
// customer holds a print of. It is wrong for the POS shift-close Contra and
// variance Journal: those are bookkeeping plumbing the system raises for itself,
// nobody is ever handed one, and a wrong close is not "this voucher happened and
// was undone" — it is "these figures were wrong, here are the right ones". So a
// shift reopen PARKS them (ledger effect taken back out, row kept as DRAFT,
// voucher number kept) and the re-close REPOSTS the same rows with fresh figures.
// One shift close, one Contra number, however many times it is reopened.
//
//   POSTED ──park──► DRAFT ──repost──► POSTED     (same id, same voucherNo)
//                      └───discard───► gone       (never posted → nothing to audit)
//
// `discardParkedDraftInTx` writes NO AuditLog on purpose, and refuses anything
// that is not a DRAFT. A draft carries no ledger effect, no print and no history,
// so there is nothing for an audit snapshot to protect — but a POSTED system
// voucher (a POS sale is system-generated too) still gets the full treatment
// through the ordinary hard-delete route.

import type { Prisma } from "@/generated/prisma/client";
import { applyLineBalances } from "@/modules/accountancy/lib/balance";
import { retreatReconciliation } from "@/modules/accountancy/lib/reconciliation";
import { enginePost, type EngineGlLine } from "@/modules/accountancy/lib/transactionEngine";
import { isDraft, isPosted } from "@/modules/accountancy/lib/voucherLifecycle";

/**
 * POSTED → DRAFT. Takes the cached balance deltas back out (exactly as cancel
 * does) and pulls back any reconciliation the posting dirtied, then parks the row
 * as a DRAFT keeping its id, its voucher number and its GL lines — so the drafts
 * list still shows what the wrong close said.
 *
 * A voucher somebody already cancelled by hand had its balances reversed once
 * already; only the status moves. Already a draft → nothing to do. Gone → false.
 */
export async function parkVoucherAsDraftInTx(
    tx: Prisma.TransactionClient,
    voucherId: number,
): Promise<boolean> {
    const voucher = await tx.universalVoucher.findUnique({
        where:   { id: voucherId },
        include: { lines: true },
    });
    if (!voucher) return false;            // hard-deleted — nothing left to park
    if (isDraft(voucher)) return true;     // already parked

    if (isPosted(voucher)) {
        await applyLineBalances(tx, voucher.lines, "reverse");
        // Un-posting dirties a reconciled window exactly as much as posting did.
        await retreatReconciliation(tx, voucher.lines.map((l) => l.accountId), voucher.date);
    }

    await tx.universalVoucher.update({
        where: { id: voucherId },
        data: {
            status:        "DRAFT",
            postedAt:      null,
            cancelledAt:   null,
            cancelledById: null,
            cancelReason:  null,
        },
    });
    return true;
}

/**
 * DRAFT → POSTED with fresh figures, on the SAME row. The old GL lines go, the
 * new ones are written by the engine's ATTACH path (`existingSpineId`), which
 * also re-applies the balance deltas and flips the status. The spine's own `date`
 * is set here because ATTACH deliberately leaves it alone — a re-close may be
 * stamped with a different day than the wrong close was.
 *
 * Returns false when the row is missing or is not a DRAFT, so a caller can fall
 * back to raising a fresh voucher.
 */
export async function repostParkedVoucherInTx(
    tx: Prisma.TransactionClient,
    args: {
        voucherId:   number;
        type:        string;
        date:        Date;
        description: string;
        narration?:  string | null;
        glLines:     EngineGlLine[];
        userId:      number;
        postedAt?:   Date;
    },
): Promise<boolean> {
    const voucher = await tx.universalVoucher.findUnique({
        where:  { id: args.voucherId },
        select: { id: true, status: true },
    });
    if (!voucher || !isDraft(voucher)) return false;

    await tx.voucherGlLine.deleteMany({ where: { universalVoucherId: args.voucherId } });
    await tx.universalVoucher.update({ where: { id: args.voucherId }, data: { date: args.date } });
    await enginePost(
        tx,
        {
            type:        args.type,
            date:        args.date,
            description: args.description,
            narration:   args.narration ?? null,
            glLines:     args.glLines,
            stockMoves:  [],
        },
        args.userId,
        { existingSpineId: args.voucherId, ...(args.postedAt ? { postedAt: args.postedAt } : {}) },
    );
    return true;
}

/**
 * Remove a parked DRAFT for good — no AuditLog, because a draft never posted:
 * no ledger effect, no print, no history to protect. Refuses anything that is not
 * a DRAFT, so this can never quietly swallow a live voucher. The GL lines cascade
 * off the spine.
 *
 * The voucher number it was holding is released and becomes a gap in that series;
 * these are internal Contra / Journal series, never printed for anyone.
 */
export async function discardParkedDraftInTx(
    tx: Prisma.TransactionClient,
    voucherId: number,
): Promise<boolean> {
    const voucher = await tx.universalVoucher.findUnique({
        where:  { id: voucherId },
        select: { id: true, status: true },
    });
    if (!voucher || !isDraft(voucher)) return false;
    await tx.universalVoucher.delete({ where: { id: voucherId } });
    return true;
}
