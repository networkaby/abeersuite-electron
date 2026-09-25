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

    return {
        openingFloatPaise:    shift.openingFloatPaise.toString(),
        tillBookBalancePaise: tillBookBalancePaise.toString(),
        tillMovementPaise:    (tillBookBalancePaise - shift.openingFloatPaise).toString(),
        dropsPaise:           dropsPaise.toString(),
        runningExpectedPaise: computeExpectedCash(tillBookBalancePaise, dropsPaise).toString(),
        tenderBreakdown,
        movementBreakdown: {
            cashSalesPaise:    movement.cashSalesPaise.toString(),
            receiptsPaise:     movement.receiptsPaise.toString(),
            expendituresPaise: movement.expendituresPaise.toString(),
            refundsPaise:      movement.refundsPaise.toString(),
            otherPaise:        movement.otherPaise.toString(),
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
