import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
    sumPaise, computeExpectedCash, tillBalancePaise,
    buildShiftTenderBreakdown, buildShiftMovementBreakdown, buildShiftCollectionsBreakdown,
    type TenderBreakdownRow,
} from "@/modules/pos/lib/shiftMath";

type Tx = Prisma.TransactionClient | PrismaClient;

// ── The drawer of one shift, as every screen shows it ────────────────────────
//
// Expected cash, how the till moved, and what was collected by each method. The
// shift detail page, the close-shift dialog and the takeover modal all read this
// one builder, so the cashier handing over and the one taking over can never be
// shown two different drawers.

type SummaryShift = {
    id:                number;
    status:            string;
    openingFloatPaise: bigint;
    expectedCashPaise: bigint | null;
    /** A closed shift's close moment and its own closing vouchers (never "changes"). */
    closedAt?: Date | null;
    closingContraVoucherId?: number | null;
    varianceJournalEntryId?: number | null;
    counter: {
        tillAccountId:   number;
        tillAccount:     { id: number };
        paymentAccounts: { channel: string; label: string; accountId: number }[];
    };
    drops: { amountPaise: bigint }[];
};

/** Paise as strings — BigInt does not survive JSON. */
export type ShiftSummaryJson = {
    openingFloatPaise:    string;
    tillBookBalancePaise: string;
    tillMovementPaise:    string;
    dropsPaise:           string;
    runningExpectedPaise: string;
    /** A CLOSED shift only: how far its vouchers have moved the till since the
     *  close, net of correcting Journals posted on it (see shiftCashChangedAfterClose).
     *  Non-zero = the books no longer match the counted cash. null while not closed. */
    changedAfterClosePaise: string | null;
    tenderBreakdown:      TenderBreakdownRow[];
    movementBreakdown: {
        cashSalesPaise:    string;
        receiptsPaise:     string;
        expendituresPaise: string;
        refundsPaise:      string;
        otherPaise:        string;
        netMovementPaise:  string;
    };
    collectionsBreakdown: {
        salesPaise:        string;
        salesCount:        number;
        receiptsPaise:     string;
        receiptsCount:     number;
        refundsPaise:      string;
        refundsCount:      number;
        netCollectedPaise: string;
    };
};

export async function buildShiftSummary(db: Tx, shift: SummaryShift): Promise<ShiftSummaryJson> {
    const dropsPaise = sumPaise(shift.drops);

    // A closed shift's till has since been swept by its closing Contra, so its
    // book balance at close is rebuilt from what the close recorded. A running
    // shift reads the till's ledger now.
    // Read alongside the other breakdowns — only the movement waits for it.
    const tillP = (shift.status === "CLOSED" && shift.expectedCashPaise != null)
        ? Promise.resolve(shift.expectedCashPaise + dropsPaise)
        : tillBalancePaise(db, shift.counter.tillAccountId);

    const [tillBookBalancePaise, tenderBreakdown, movement, collections] = await Promise.all([
        tillP,
        buildShiftTenderBreakdown(db, { shiftId: shift.id, counter: shift.counter }),
        tillP.then((tillBookBalancePaise) => buildShiftMovementBreakdown(db, {
            shiftId:           shift.id,
            tillAccountId:     shift.counter.tillAccountId,
            tillBookBalancePaise,
            openingFloatPaise: shift.openingFloatPaise,
        })),
        buildShiftCollectionsBreakdown(db, { shiftId: shift.id, counter: shift.counter }),
    ]);

    const changed = shift.status === "CLOSED" && shift.closedAt
        ? await shiftCashChangedAfterClose(db, {
            shiftId:       shift.id,
            tillAccountId: shift.counter.tillAccountId,
            closedAt:      shift.closedAt,
            ownVoucherIds: [shift.closingContraVoucherId, shift.varianceJournalEntryId].filter((x): x is number => x != null),
        })
        : null;
    // A closed shift's movement is measured against the till the close froze, so
    // its remainder also holds what goods vouchers changed since; take that back
    // out and "Other" is again what it was at the close.
    const otherPaise = changed ? movement.otherPaise + changed.vouchersPaise : movement.otherPaise;

    return {
        openingFloatPaise:    shift.openingFloatPaise.toString(),
        tillBookBalancePaise: tillBookBalancePaise.toString(),
        tillMovementPaise:    (tillBookBalancePaise - shift.openingFloatPaise).toString(),
        dropsPaise:           dropsPaise.toString(),
        runningExpectedPaise: computeExpectedCash(tillBookBalancePaise, dropsPaise).toString(),
        changedAfterClosePaise: changed ? (changed.vouchersPaise + changed.correctionsPaise).toString() : null,
        tenderBreakdown,
        movementBreakdown: {
            cashSalesPaise:    movement.cashSalesPaise.toString(),
            receiptsPaise:     movement.receiptsPaise.toString(),
            expendituresPaise: movement.expendituresPaise.toString(),
            refundsPaise:      movement.refundsPaise.toString(),
            otherPaise:        otherPaise.toString(),
            netMovementPaise:  movement.netMovementPaise.toString(),
        },
        collectionsBreakdown: {
            salesPaise:        collections.salesPaise.toString(),
            salesCount:        collections.salesCount,
            receiptsPaise:     collections.receiptsPaise.toString(),
            receiptsCount:     collections.receiptsCount,
            refundsPaise:      collections.refundsPaise.toString(),
            refundsCount:      collections.refundsCount,
            netCollectedPaise: collections.netCollectedPaise.toString(),
        },
    };
}

type GlLineLite = { accountId: unknown; type: unknown; amount: unknown };

/**
 * How far a closed shift's own vouchers have moved its till since the close.
 *
 * Measured voucher by voucher — till lines now, less till lines at the close —
 * so nothing outside the shift (a till entry carrying no shift) can creep in:
 *   • edited after the close  → "at close" is the copy the first such edit saved
 *     (AuditLog PRE_EDIT — an INV voucher keeps its spine as `journalEntry`, a GL
 *     voucher is the spine itself);
 *   • cancelled after it      → "now" is nothing; deleted after it → only the
 *     saved copy is left, and it counts as gone;
 *   • raised after it on this shift → "at close" was nothing. That is how a
 *     correcting Journal (after-close-correction) cancels the difference out —
 *     reported apart as `correctionsPaise`.
 * The close's own Contra and variance Journal are not changes.
 */
export async function shiftCashChangedAfterClose(db: Tx, args: {
    shiftId: number; tillAccountId: number; closedAt: Date; ownVoucherIds: number[];
}): Promise<{ vouchersPaise: bigint; correctionsPaise: bigint }> {
    const till = (lines: GlLineLite[] | null | undefined): bigint => (lines ?? [])
        .filter((l) => Number(l.accountId) === args.tillAccountId)
        .reduce((sum, l) => sum + BigInt(Math.round(Number(l.amount) * 100)) * (l.type === "DEBIT" ? BigInt(1) : BigInt(-1)), BigInt(0));

    const [vouchers, copies] = await Promise.all([
        db.universalVoucher.findMany({
            where:  { sourceShiftId: args.shiftId, id: { notIn: args.ownVoucherIds } },
            select: {
                id: true, type: true, status: true, createdAt: true, cancelledAt: true,
                lines: { where: { accountId: args.tillAccountId }, select: { accountId: true, type: true, amount: true } },
            },
        }),
        db.auditLog.findMany({
            where: {
                createdAt:  { gt: args.closedAt },
                entityType: { in: ["INV_VOUCHER", "GL_VOUCHER"] },
                OR: [
                    { snapshot: { path: ["journalEntry", "sourceShiftId"], equals: args.shiftId } },
                    { snapshot: { path: ["sourceShiftId"], equals: args.shiftId } },
                ],
            },
            orderBy: { id: "asc" },
            select:  { entityType: true, snapshot: true },
        }),
    ]);

    // The first copy saved after the close is the voucher as the close saw it.
    const atCloseById = new Map<number, bigint>();
    for (const c of copies) {
        const snap = c.snapshot as Record<string, unknown>;
        const spine = (c.entityType === "INV_VOUCHER" ? snap.journalEntry : snap) as { id?: unknown; status?: unknown; lines?: GlLineLite[] } | null;
        const id = Number(spine?.id);
        if (!id || atCloseById.has(id) || args.ownVoucherIds.includes(id)) continue;
        atCloseById.set(id, spine?.status === "POSTED" ? till(spine.lines) : BigInt(0));
    }

    let vouchersPaise = BigInt(0);
    let correctionsPaise = BigInt(0);
    const seen = new Set<number>();
    for (const v of vouchers) {
        seen.add(v.id);
        const now = v.status === "POSTED" ? till(v.lines) : BigInt(0);
        const raisedAfter = v.createdAt > args.closedAt && !atCloseById.has(v.id);
        const atClose = atCloseById.get(v.id)
            ?? (raisedAfter ? BigInt(0)
                : v.cancelledAt && v.cancelledAt > args.closedAt ? till(v.lines)
                : now);
        if (raisedAfter && v.type === "JOURNAL") correctionsPaise += now;
        else vouchersPaise += now - atClose;
    }
    for (const [id, atClose] of atCloseById) {
        if (!seen.has(id)) vouchersPaise -= atClose;   // deleted since the close
    }
    return { vouchersPaise, correctionsPaise };
}
