// A POS sale of a CLOSED shift whose cash changed on edit (UPI → cash) — correct
// that shift's close in the same save, so the books match the cash that was
// counted. Server-only; runs inside the voucher PATCH transaction.
//
// The edit has just moved the shift's till by `deltaPaise` on the sale's own
// date. What the cashier counted stands, and so do the carry-over and the vault
// sweep — so later shifts never move. Only what the close worked out from the
// books is redone:
//
//   expected = expected at close + delta        variance = counted − expected
//
// and the shift's own variance Journal follows: rewritten in place (same voucher
// number) through the same park → repost the shift reopen uses, discarded when
// the variance comes to nil, raised when there was none. The Journal as it stood
// is kept in AuditLog first, and a line on the shift's notes says what changed,
// so the shift report and its print show it.
//
// Rewriting a posted Journal deletes its old lines, which a counter's replica
// refuses — callers check `shouldWriteLocal()` first (see the voucher PATCH).

import type { Prisma } from "@/generated/prisma/client";
import { enginePost } from "@/modules/accountancy/lib/transactionEngine";
import { parkVoucherAsDraftInTx, repostParkedVoucherInTx, discardParkedDraftInTx } from "@/modules/accountancy/lib/parkVoucherInTx";
import { auditSnapshot } from "@/modules/accountancy/lib/voucherLifecycle";
import { PRE_EDIT_ACTION } from "@/shared/lib/accountancy/auditSnapshotKind";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import { startOfDayUtc, businessTodayIso, formatDate } from "@/shared/lib/format/formatDate";
import { fmt } from "@/shared/lib/format/moneyInr";
import type { TenderInput } from "@/shared/lib/accountancy/settlement";

const signedRupees = (paise: bigint) => `${paise < BigInt(0) ? "−" : "+"}₹${fmt(Math.abs(Number(paise)) / 100)}`;

/** Cash a sale's payment rows put in one till (paise). */
export function tillPaiseOf(tenders: TenderInput[], tillAccountId: number): bigint {
    return tenders
        .filter((t) => t.accountId === tillAccountId)
        .reduce((sum, t) => sum + BigInt(Math.round(Number(t.amount) * 100)), BigInt(0));
}

export async function correctClosedShiftForEdit(tx: Prisma.TransactionClient, args: {
    shiftId:    number;
    deltaPaise: bigint;
    /** The edited sale's number, for the note. */
    voucherNo:  string;
    userId:     number;
}): Promise<void> {
    if (args.deltaPaise === BigInt(0)) return;
    const shift = await tx.posShift.findUnique({
        where:  { id: args.shiftId },
        select: {
            id: true, status: true, branchId: true, closedAt: true, notes: true,
            expectedCashPaise: true, declaredCashPaise: true, variancePaise: true, varianceJournalEntryId: true,
            counter: { select: { tillAccountId: true } },
        },
    });
    if (!shift || shift.status !== "CLOSED" || shift.expectedCashPaise == null || shift.declaredCashPaise == null || !shift.closedAt) return;

    const expected = shift.expectedCashPaise + args.deltaPaise;
    const variance = shift.declaredCashPaise - expected;

    // ── The variance Journal follows the new variance ──────────────────────
    let varianceJournalId = shift.varianceJournalEntryId;
    const oldJournal = varianceJournalId != null
        ? await tx.universalVoucher.findUnique({ where: { id: varianceJournalId }, include: { lines: true } })
        : null;
    if (oldJournal?.status === "POSTED") {
        await tx.auditLog.create({
            data: auditSnapshot({
                entityType:  "GL_VOUCHER",
                subtype:     oldJournal.type,
                originalId:  oldJournal.id,
                originalRef: oldJournal.voucherNo ?? formatUvNo(oldJournal.id),
                reason:      `Edit (in-place) of ${oldJournal.voucherNo ?? formatUvNo(oldJournal.id)} — ${args.voucherNo} changed after Shift #${shift.id} closed`,
                action:      PRE_EDIT_ACTION,
                snapshot:    { ...oldJournal },
                actorId:     args.userId,
            }),
        });
        await parkVoucherAsDraftInTx(tx, oldJournal.id);
    }
    if (variance === BigInt(0)) {
        if (oldJournal) await discardParkedDraftInTx(tx, oldJournal.id);
        varianceJournalId = null;
    } else {
        const [shortAcc, overAcc] = await Promise.all([
            tx.account.findFirst({ where: { name: "Cash Short" }, select: { id: true } }),
            tx.account.findFirst({ where: { name: "Cash Over" },  select: { id: true } }),
        ]);
        if (!shortAcc || !overAcc) throw new Error("Cash Short / Cash Over ledgers missing. Re-run bootstrap seed.");
        // Same lines and wording as the shift close posts.
        const rupees = Math.abs(Number(variance)) / 100;
        const tillId = shift.counter.tillAccountId;
        const glLines = variance > BigInt(0)
            ? [
                { accountId: tillId,     type: "DEBIT"  as const, amount: rupees, description: "Cash drawer over" },
                { accountId: overAcc.id, type: "CREDIT" as const, amount: rupees, description: "Cash Over (POS variance)" },
            ]
            : [
                { accountId: shortAcc.id, type: "DEBIT"  as const, amount: rupees, description: "Cash Short (POS variance)" },
                { accountId: tillId,      type: "CREDIT" as const, amount: rupees, description: "Cash drawer short" },
            ];
        const description = `Shift #${shift.id} variance — ${variance > BigInt(0) ? "over" : "short"} ₹${rupees}`;
        const date = oldJournal?.date ?? startOfDayUtc(businessTodayIso(shift.closedAt));
        const reposted = oldJournal != null && await repostParkedVoucherInTx(tx, {
            voucherId: oldJournal.id, type: "JOURNAL", date, description, glLines, userId: args.userId, branchId: shift.branchId,
        });
        if (!reposted) {
            const { journalEntryId } = await enginePost(tx, { type: "JOURNAL", date, description, glLines, stockMoves: [] }, args.userId, { branchId: shift.branchId });
            varianceJournalId = journalEntryId;
        }
    }

    // ── The shift's own figures, and a line saying why they moved ──────────
    const editor = await tx.user.findUnique({ where: { id: args.userId }, select: { name: true } });
    const note = `Corrected ${formatDate(new Date())} by ${editor?.name ?? "staff"}: ${args.voucherNo} changed after close (${signedRupees(args.deltaPaise)}) — `
        + `expected ₹${fmt(Number(shift.expectedCashPaise) / 100)} → ₹${fmt(Number(expected) / 100)}, `
        + `variance ${signedRupees(shift.variancePaise ?? BigInt(0))} → ${signedRupees(variance)}.`;
    await tx.posShift.update({
        where: { id: shift.id },
        data:  {
            expectedCashPaise:      expected,
            variancePaise:          variance,
            varianceJournalEntryId: varianceJournalId,
            notes:                  shift.notes ? `${shift.notes}\n${note}` : note,
        },
    });
}
