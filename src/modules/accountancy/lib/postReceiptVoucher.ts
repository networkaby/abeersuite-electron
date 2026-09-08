// ── postReceiptVoucher — atomic Receipt voucher + JE + bill allocation ──────
//
// Replaces the legacy `postPosReceiptJe` + `Payment` model. Each customer
// receipt becomes a single `Voucher type=RECEIPT` with one debit line per
// tender (cash till / bank / UPI / card) and one credit line that closes the
// customer's AR. A mirror JournalEntry is posted and Account.balance is
// updated for every line. When `allocateToJournalEntryId` is provided, a
// `VoucherAllocation` (AGAINST_REF) ties the receipt to the originating
// InvVoucher's JE so `outstandings.ts` can net it out of receivables.
//
// Used by:
//   • POS sale (single-tap settlement at the counter)
//   • Office "record receipt against invoice" flow
//   • Any future credit-collection screen
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

export async function postReceiptVoucher(
    tx: Prisma.TransactionClient,
    args: PostReceiptVoucherArgs,
): Promise<PostReceiptVoucherResult> {
    const total = args.tenders.reduce((s, t) => s + t.amount, 0);
    if (total <= 0) throw new Error("Receipt voucher has zero amount.");
    if (args.tenders.length === 0) throw new Error("Receipt voucher needs at least one tender line.");

    // 1-3. Create + post the RECEIPT via the Transaction Engine: one debit line
    // per tender + one credit line closing the customer's AR. The engine writes
    // the mirror JournalEntry and the per-line Account.balance deltas (with the
    // null-normalBalance group-nature fallback the AR/AP party ledgers need).
    // `postedAt = args.date` preserves the auto-settled receipt's posting stamp.
    const voucher = await engineCreateVoucher(tx, {
        type:           "RECEIPT",
        date:           args.date,
        userId:         args.userId,
        partyAccountId: args.customerAccountId,
        narration:      args.narration ?? null,
        lines: [
            ...args.tenders.map((t) => ({
                accountId:   t.accountId,
                type:        "DEBIT" as const,
                amount:      t.amount,
                description: t.description ?? null,
            })),
            {
                accountId:   args.customerAccountId,
                type:        "CREDIT" as const,
                amount:      total,
                description: args.narration ?? null,
            },
        ],
        post:          true,
        branchId:      args.branchId ?? null,
        postedAt:      args.date,
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

    // Never allocate more than the receipt actually received — an over-allocation
    // would mis-state receivables; throwing here rolls back the whole transaction.
    const allocSum = allocationPlan.reduce((s, a) => s + a.amount, 0);
    if (allocSum > total + 0.01) {
        throw new Error(
            `Receipt allocation (₹${allocSum.toFixed(2)}) exceeds receipt total (₹${total.toFixed(2)}).`,
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
        allocationIds.push(await createLink(tx, {
            targetId:  a.universalVoucherId,   // the bill — the receivable side
            sourceId:  voucher.id,             // this receipt — the paying side
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
