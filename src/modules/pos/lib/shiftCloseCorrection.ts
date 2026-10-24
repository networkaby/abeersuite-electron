// Correct a CLOSED shift's close in place, without reopening it. Server-only;
// runs inside the caller's transaction. Two callers:
//
//   • correctClosedShiftForEdit — a POS sale of the shift had its cash changed on
//     edit (UPI → cash). The books moved by `deltaPaise`; what the cashier counted
//     stands:          expected = expected at close + delta
//                      variance = counted − expected
//
//   • correctClosedShiftCount — the manager fixes a wrong physical count on ANY
//     closed shift, not just the latest on the counter. The books stand:
//                      variance = new count − expected
//                      toVault  = new count + drops − carry-over
//
// Either way the carry-over is never touched, so the till still ends the shift
// at exactly the carry-over and later shifts never move. (A wrong count moves the
// variance Journal and the vault sweep by the same amount, in opposite
// directions on the till.)
//
// The shift's own variance Journal and closing Contra follow: rewritten in place
// (same voucher number) through the same park → repost the shift reopen uses,
// discarded when the figure comes to nil, raised when there was none. Each posted
// voucher as it stood is kept in AuditLog first, and a line on the shift's notes
// says what changed, so the shift report and its print show it.
//
// Rewriting a posted voucher deletes its old lines, which a counter's replica
// refuses — callers run on the authoritative database, or check
// `shouldWriteLocal()` first (see the voucher PATCH).

import type { Prisma } from "@/generated/prisma/client";
import { enginePost } from "@/modules/accountancy/lib/transactionEngine";
import { postContra } from "@/modules/accountancy/lib/postContra";
import { parkVoucherAsDraftInTx, repostParkedVoucherInTx, discardParkedDraftInTx } from "@/modules/accountancy/lib/parkVoucherInTx";
import { auditSnapshot } from "@/modules/accountancy/lib/voucherLifecycle";
import { PRE_EDIT_ACTION } from "@/shared/lib/accountancy/auditSnapshotKind";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import { startOfDayUtc, businessTodayIso, formatDate } from "@/shared/lib/format/formatDate";
import { fmt } from "@/shared/lib/format/moneyInr";
import type { TenderInput } from "@/shared/lib/accountancy/settlement";

const signedRupees = (paise: bigint) => `${paise < BigInt(0) ? "−" : "+"}₹${fmt(Math.abs(Number(paise)) / 100)}`;
const rupees = (paise: bigint) => `₹${fmt(Number(paise) / 100)}`;

/** Cash a sale's payment rows put in one till (paise). */
export function tillPaiseOf(tenders: TenderInput[], tillAccountId: number): bigint {
    return tenders
        .filter((t) => t.accountId === tillAccountId)
        .reduce((sum, t) => sum + BigInt(Math.round(Number(t.amount) * 100)), BigInt(0));
}

// ── Shared: one system voucher of the close, rewritten in place ──────────────

type ClosedShiftRef = { id: number; branchId: string; closedAt: Date };

/**
 * Parks the shift's existing voucher (snapshotting it first when posted), then
 * reposts it with `glLines`, discards it when `glLines` is null, or raises a
 * fresh one when there was nothing to repost. Returns the voucher id the shift
 * should now carry.
 */
async function rewriteCloseVoucherInTx(tx: Prisma.TransactionClient, args: {
    shift:       ClosedShiftRef;
    voucherId:   number | null;
    type:        "JOURNAL" | "CONTRA";
    description: string;
    glLines:     { accountId: number; type: "DEBIT" | "CREDIT"; amount: number; description: string }[] | null;
    userId:      number;
    auditReason: string;
}): Promise<number | null> {
    const old = args.voucherId != null
        ? await tx.universalVoucher.findUnique({ where: { id: args.voucherId }, include: { lines: true } })
        : null;
    if (old) {
        if (old.status === "POSTED") {
            const ref = old.voucherNo ?? formatUvNo(old.id);
            await tx.auditLog.create({
                data: auditSnapshot({
                    entityType:  "GL_VOUCHER",
                    subtype:     old.type,
                    originalId:  old.id,
                    originalRef: ref,
                    reason:      `Edit (in-place) of ${ref} — ${args.auditReason}`,
                    action:      PRE_EDIT_ACTION,
                    snapshot:    { ...old },
                    actorId:     args.userId,
                }),
            });
        }
        await parkVoucherAsDraftInTx(tx, old.id);
    }

    if (!args.glLines) {
        if (old) await discardParkedDraftInTx(tx, old.id);
        return null;
    }
    const date = old?.date ?? startOfDayUtc(businessTodayIso(args.shift.closedAt));
    const narration = args.type === "CONTRA" ? args.description : null;
    const reposted = old != null && await repostParkedVoucherInTx(tx, {
        voucherId: old.id, type: args.type, date, description: args.description, narration,
        glLines: args.glLines, userId: args.userId, branchId: args.shift.branchId,
    });
    if (reposted) return old.id;
    if (args.type === "CONTRA") {
        return (await postContra(tx, { date, narration: args.description, userId: args.userId, lines: args.glLines, branchId: args.shift.branchId })).voucherId;
    }
    const { journalEntryId } = await enginePost(tx, { type: "JOURNAL", date, description: args.description, glLines: args.glLines, stockMoves: [] }, args.userId, { branchId: args.shift.branchId });
    return journalEntryId;
}

/** The variance Journal's lines — same accounts and wording the shift close posts. Null for nil. */
async function varianceLines(tx: Prisma.TransactionClient, shiftId: number, tillId: number, variance: bigint) {
    if (variance === BigInt(0)) return { description: "", glLines: null };
    // One after another: inside a transaction (one connection) pg 9 refuses parallel queries.
    const shortAcc = await tx.account.findFirst({ where: { name: "Cash Short" }, select: { id: true } });
    const overAcc = await tx.account.findFirst({ where: { name: "Cash Over" },  select: { id: true } });
    if (!shortAcc || !overAcc) throw new Error("Cash Short / Cash Over ledgers missing. Re-run bootstrap seed.");
    const amount = Math.abs(Number(variance)) / 100;
    const glLines = variance > BigInt(0)
        ? [
            { accountId: tillId,     type: "DEBIT"  as const, amount, description: "Cash drawer over" },
            { accountId: overAcc.id, type: "CREDIT" as const, amount, description: "Cash Over (POS variance)" },
        ]
        : [
            { accountId: shortAcc.id, type: "DEBIT"  as const, amount, description: "Cash Short (POS variance)" },
            { accountId: tillId,      type: "CREDIT" as const, amount, description: "Cash drawer short" },
        ];
    return { description: `Shift #${shiftId} variance — ${variance > BigInt(0) ? "over" : "short"} ₹${amount}`, glLines };
}

async function appendNote(tx: Prisma.TransactionClient, notes: string | null, userId: number, text: (editor: string) => string) {
    const editor = await tx.user.findUnique({ where: { id: userId }, select: { name: true } });
    const note = text(editor?.name ?? "staff");
    return notes ? `${notes}\n${note}` : note;
}

// ── A sale of the shift changed after close ─────────────────────────────────

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

    const lines = await varianceLines(tx, shift.id, shift.counter.tillAccountId, variance);
    const varianceJournalId = await rewriteCloseVoucherInTx(tx, {
        shift: { id: shift.id, branchId: shift.branchId, closedAt: shift.closedAt },
        voucherId: shift.varianceJournalEntryId, type: "JOURNAL", ...lines, userId: args.userId,
        auditReason: `${args.voucherNo} changed after Shift #${shift.id} closed`,
    });

    const notes = await appendNote(tx, shift.notes, args.userId, (editor) =>
        `Corrected ${formatDate(new Date())} by ${editor}: ${args.voucherNo} changed after close (${signedRupees(args.deltaPaise)}) — `
        + `expected ${rupees(shift.expectedCashPaise!)} → ${rupees(expected)}, `
        + `variance ${signedRupees(shift.variancePaise ?? BigInt(0))} → ${signedRupees(variance)}.`);
    await tx.posShift.update({
        where: { id: shift.id },
        data:  { expectedCashPaise: expected, variancePaise: variance, varianceJournalEntryId: varianceJournalId, notes },
    });
}

// ── The manager corrects the physical count ─────────────────────────────────

/** Thrown for a correction the shift cannot take; the message is for the user. */
export class ShiftCountCorrectionError extends Error {}

export async function correctClosedShiftCount(tx: Prisma.TransactionClient, args: {
    shiftId:           number;
    declaredCashPaise: bigint;
    reason:            string;
    userId:            number;
}): Promise<void> {
    const shift = await tx.posShift.findUnique({
        where:  { id: args.shiftId },
        select: {
            id: true, status: true, branchId: true, closedAt: true, notes: true, handoverToShiftId: true,
            expectedCashPaise: true, declaredCashPaise: true, variancePaise: true, carryOverNextPaise: true, toVaultPaise: true,
            varianceJournalEntryId: true, closingContraVoucherId: true,
            drops:   { select: { amountPaise: true } },
            counter: { select: { name: true, tillAccountId: true } },
            branch:  { select: { name: true, vaultAccountId: true } },
        },
    });
    if (!shift) throw new ShiftCountCorrectionError("Shift not found");
    if (shift.status !== "CLOSED" || !shift.closedAt) throw new ShiftCountCorrectionError("Only a closed shift's count can be corrected");
    if (shift.handoverToShiftId != null) {
        throw new ShiftCountCorrectionError(`This shift was handed over to shift #${shift.handoverToShiftId} — its cash moved into that shift, so its count cannot be changed.`);
    }
    if (shift.expectedCashPaise == null || shift.declaredCashPaise == null || shift.carryOverNextPaise == null) {
        throw new ShiftCountCorrectionError("This shift has no closing count to correct");
    }
    if (args.declaredCashPaise === shift.declaredCashPaise) throw new ShiftCountCorrectionError("The count is the same as before");

    const carryOver = shift.carryOverNextPaise;
    const drops     = shift.drops.reduce((s, d) => s + d.amountPaise, BigInt(0));
    const toVault   = args.declaredCashPaise + drops - carryOver;
    // The till must still end at the carry-over the next shift started from.
    if (toVault < BigInt(0)) {
        throw new ShiftCountCorrectionError(`The count cannot be less than the ${rupees(carryOver - drops)} kept in the counter for the next shift.`);
    }
    if (toVault > BigInt(0) && !shift.branch.vaultAccountId) {
        throw new ShiftCountCorrectionError(`Branch ${shift.branch.name} has no Vault account configured.`);
    }
    const variance = args.declaredCashPaise - shift.expectedCashPaise;
    const ref = { id: shift.id, branchId: shift.branchId, closedAt: shift.closedAt };
    const auditReason = `count of Shift #${shift.id} corrected: ${args.reason}`;
    const tillId = shift.counter.tillAccountId;

    // Same order as the close: variance first, then the sweep.
    const lines = await varianceLines(tx, shift.id, tillId, variance);
    const varianceJournalId = await rewriteCloseVoucherInTx(tx, {
        shift: ref, voucherId: shift.varianceJournalEntryId, type: "JOURNAL", ...lines, userId: args.userId, auditReason,
    });
    const sweep = Number(toVault) / 100;
    const closingContraId = await rewriteCloseVoucherInTx(tx, {
        shift: ref, voucherId: shift.closingContraVoucherId, type: "CONTRA", userId: args.userId, auditReason,
        description: `Shift close — ${shift.counter.name} → Vault (${shift.branch.name})`,
        glLines: toVault === BigInt(0) ? null : [
            { accountId: shift.branch.vaultAccountId!, type: "DEBIT"  as const, amount: sweep, description: "Cash received from counter" },
            { accountId: tillId,                       type: "CREDIT" as const, amount: sweep, description: `Cash swept to vault (keep ₹${Number(carryOver) / 100} in counter)` },
        ],
    });

    const notes = await appendNote(tx, shift.notes, args.userId, (editor) =>
        `Count corrected ${formatDate(new Date())} by ${editor}: counted ${rupees(shift.declaredCashPaise!)} → ${rupees(args.declaredCashPaise)}, `
        + `variance ${signedRupees(shift.variancePaise ?? BigInt(0))} → ${signedRupees(variance)}, `
        + `to vault ${rupees(shift.toVaultPaise ?? BigInt(0))} → ${rupees(toVault)}. Reason: ${args.reason}`);
    await tx.posShift.update({
        where: { id: shift.id },
        data:  {
            declaredCashPaise:      args.declaredCashPaise,
            variancePaise:          variance,
            toVaultPaise:           toVault,
            varianceJournalEntryId: varianceJournalId,
            closingContraVoucherId: closingContraId,
            notes,
        },
    });
}
