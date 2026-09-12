// ── postSettlementVoucher — atomic settlement voucher + GL + bill link ──────
//
// One writer for both directions of settling a party:
//
//   RECEIPT — money IN.  Debit each tender (till / bank / UPI / card), credit
//             the customer, closing what they owed us.
//   PAYMENT — money OUT. The exact mirror: credit each tender, debit the
//             supplier, closing what we owed them.
//
// The two differ only in which side the legs sit on, so they share every other
// rule — the amount guard, the posting, the balance deltas and the bill link.
// `postReceiptVoucher` stays as the RECEIPT-only wrapper its four POS callers
// already use, so nothing at the counter changed.
//
// A link (AGAINST_REF) ties the voucher to the bill(s) it settles, so
// `outstandings.ts` nets it out. Orientation follows the same rule as every
// other link: the RECEIVABLE side is stored as the target — the bill for a
// receipt, the voucher itself for a payment.
//
// Used by:
//   • POS sale (single-tap settlement at the counter)
//   • the bill-wise popup's Receive now / Pay now
//   • online / ecommerce receipts
//
// Caller passes resolved account ids — this helper does no account lookup
// (no "Cash-in-Hand" name search) to keep the contract simple and the
// dependency surface small.

import type { Prisma } from "@/generated/prisma/client";
import { engineCreateVoucher } from "./transactionEngine";
import { createLink } from "./billLink";

export type ReceiptTender = {
    accountId:    number;           // till / bank / UPI / card ledger to debit
    amount:       number;           // rupees, > 0
    description?: string;           // free-text per line (e.g. "UPI ref ABC123")
};

/** Which way the money moves. RECEIPT = in, PAYMENT = out. */
export type SettlementKind = "RECEIPT" | "PAYMENT";

export type PostSettlementVoucherArgs = Omit<PostReceiptVoucherArgs, "customerAccountId"> & {
    kind:           SettlementKind;
    /** The party ledger being settled — credited on a receipt, debited on a payment. */
    partyAccountId: number;
};

export type PostReceiptVoucherArgs = {
    customerAccountId: number;      // AR ledger being settled (credited)
    tenders:           ReceiptTender[];
    date:              Date;
    userId:            number;
    narration?:        string;
    /** Branch context stamped on the journal lines (branch-scoped GL reports). */
    branchId?:         string;
    /** POS counter the receipt was taken at — the counter part of the reference.
     *  Omit for office / online receipts that belong to no counter. */
    counterNumber?:    number | null;
    /**
     * When set, a VoucherAllocation row links this receipt to the originating
     * bill's universal-voucher spine — Receivables nets the amount out. Pass
     * `InvVoucher.universalVoucherId` for POS sales / office credit settlements.
     */
    allocateToUniversalVoucherId?: number;
    /**
     * Multi-bill allocation (FIFO collect-on-the-go): one VoucherAllocation per
     * entry, tying parts of this receipt to several bills' spine rows. Takes
     * precedence over `allocateToUniversalVoucherId` when present. The sum is
     * asserted ≤ the receipt total so a receipt can never allocate more than it
     * received (an unallocated remainder simply stays as a customer advance).
     */
    allocations?: { universalVoucherId: number; amount: number }[];
};

export type PostReceiptVoucherResult = {
    voucherId:      number;
    voucherRef:     string;
    journalEntryId: number;
    /** First/only allocation id (back-compat with the single-target callers). */
    allocationId:   number | null;
    /** All allocation ids created (multi-bill FIFO path). */
    allocationIds:  number[];
};

/** RECEIPT-only wrapper — the shape the POS and online callers already pass. */
export async function postReceiptVoucher(
    tx: Prisma.TransactionClient,
    args: PostReceiptVoucherArgs,
): Promise<PostReceiptVoucherResult> {
    const { customerAccountId, ...rest } = args;
    return postSettlementVoucher(tx, { ...rest, kind: "RECEIPT", partyAccountId: customerAccountId });
}

export async function postSettlementVoucher(
    tx: Prisma.TransactionClient,
    args: PostSettlementVoucherArgs,
): Promise<PostReceiptVoucherResult> {
    const total = args.tenders.reduce((s, t) => s + t.amount, 0);
    if (total <= 0) throw new Error("Receipt voucher has zero amount.");
    if (args.tenders.length === 0) throw new Error("Receipt voucher needs at least one tender line.");

    // 1-3. Create + post the RECEIPT via the Transaction Engine: one debit line
    // per tender + one credit line closing the customer's AR. The engine writes
    // the mirror JournalEntry and the per-line Account.balance deltas (with the
    // null-normalBalance group-nature fallback the AR/AP party ledgers need).
    // `postedAt` is left unset so the engine defaults it to the real posting
    // time (`new Date()`), like every other voucher type. `date` still carries
    // the ledger/business date, so shift-window and Day-Book readers that key
    // off the real timestamp see the transaction at its true moment.
    // Money in debits the till and credits the party; money out is the mirror.
    const tenderSide = args.kind === "RECEIPT" ? "DEBIT" as const : "CREDIT" as const;
    const partySide  = args.kind === "RECEIPT" ? "CREDIT" as const : "DEBIT" as const;

    const voucher = await engineCreateVoucher(tx, {
        type:           args.kind,
        date:           args.date,
        userId:         args.userId,
        partyAccountId: args.partyAccountId,
        narration:      args.narration ?? null,
        lines: [
            ...args.tenders.map((t) => ({
                accountId:   t.accountId,
                type:        tenderSide,
                amount:      t.amount,
                description: t.description ?? null,
            })),
            {
                accountId:   args.partyAccountId,
                type:        partySide,
                amount:      total,
                description: args.narration ?? null,
            },
        ],
        post:          true,
        branchId:      args.branchId ?? null,
        counterNumber: args.counterNumber ?? null,
    });
    const voucherRef = voucher.reference;

    // 4. Bill-wise allocation against the originating InvVoucher JE(s).
    //    `allocations` (multi-bill FIFO) wins; else the single-target shortcut;
    //    else nothing (pure advance — the Cr to the customer stands as credit).
    const allocationPlan: { universalVoucherId: number; amount: number }[] =
        args.allocations != null && args.allocations.length > 0
            ? args.allocations.filter((a) => a.amount > 0.005)
            : args.allocateToUniversalVoucherId != null
                ? [{ universalVoucherId: args.allocateToUniversalVoucherId, amount: total }]
                : [];

    // Never allocate more than the voucher actually moved — an over-allocation
    // would mis-state the books; throwing here rolls back the whole transaction.
    const allocSum = allocationPlan.reduce((s, a) => s + a.amount, 0);
    if (allocSum > total + 0.01) {
        throw new Error(
            `Allocation (₹${allocSum.toFixed(2)}) exceeds the voucher total (₹${total.toFixed(2)}).`,
        );
    }

    // Allocate directly against the bill's universal-voucher spine (G5 — the JE
    // hop is gone; the caller passes the spine id), through the one link writer in
    // `billLink.ts` so this path and the manual popup cannot drift apart.
    //
    // The full `assertLinkable` check is deliberately NOT run here: this is inside
    // the POS sale transaction, and re-deriving party legs per bill would put a
    // handful of extra round trips between the customer and their receipt. It is
    // safe because the callers plan against `getOpenSaleBillsForFifo`, which
    // already clamps every entry to that bill's own outstanding, and the total
    // guard above covers the receipt side. The manual path, where a human picks
    // arbitrary vouchers, does run the full check.
    const allocationIds: number[] = [];
    for (const a of allocationPlan) {
        // The receivable side is always the target. On a receipt that is the bill
        // (the customer owed us); on a payment it is this voucher (paying a
        // supplier debits them). Same rule `assertLinkable` normalises to, so the
        // pair-unique index sees one orientation whichever path wrote the row.
        const bill = a.universalVoucherId;
        allocationIds.push(await createLink(tx, {
            targetId:  args.kind === "RECEIPT" ? bill : voucher.id,
            sourceId:  args.kind === "RECEIPT" ? voucher.id : bill,
            amount:    a.amount,
            reference: voucherRef,
            userId:    args.userId,
        }));
    }

    return {
        voucherId:      voucher.id,
        voucherRef:     voucher.reference,
        journalEntryId: voucher.journalEntryId!,
        allocationId:   allocationIds[0] ?? null,
        allocationIds,
    };
}
