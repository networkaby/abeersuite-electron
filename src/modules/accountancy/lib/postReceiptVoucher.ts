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
import { balanceDelta, nextRefFromSeries, toNumber } from "./balance";
import { defaultNormalBalanceForGroupType } from "./groupNature";

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
    /**
     * When set, a VoucherAllocation row links this receipt to the originating
     * InvVoucher's journal entry — Receivables nets the amount out automatically.
     * Pass `InvVoucher.journalEntryId` for POS sales / office credit settlements.
     */
    allocateToJournalEntryId?: number;
    /**
     * Multi-bill allocation (FIFO collect-on-the-go): one VoucherAllocation per
     * entry, tying parts of this receipt to several invoices' journal entries.
     * Takes precedence over `allocateToJournalEntryId` when present. The sum is
     * asserted ≤ the receipt total so a receipt can never allocate more than it
     * received (an unallocated remainder simply stays as a customer advance).
     */
    allocations?: { journalEntryId: number; amount: number }[];
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

    const voucherRef = await nextRefFromSeries(tx, "RECEIPT", args.userId);

    // 1. Voucher row (POSTED immediately — no DRAFT detour for auto-settled receipts).
    const voucher = await tx.voucher.create({
        data: {
            type:           "RECEIPT",
            reference:      voucherRef,
            date:           args.date,
            narration:      args.narration ?? null,
            partyAccountId: args.customerAccountId,
            totalAmount:    total,
            status:         "POSTED",
            postedAt:       args.date,
            createdById:    args.userId,
            lines: {
                create: [
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
            },
        },
        select: { id: true, reference: true },
    });

    // 2. Mirror JournalEntry so Day Book / reports see the same shape as other GL postings.
    const jeRef = await nextRefFromSeries(tx, "GL_POSTING", args.userId);
    const je = await tx.journalEntry.create({
        data: {
            date:        args.date,
            reference:   jeRef,
            description: `RECEIPT ${voucherRef}${args.narration ? `: ${args.narration}` : ""}`,
            status:      "POSTED",
            postedAt:    args.date,
            createdById: args.userId,
            lines: {
                create: [
                    ...args.tenders.map((t) => ({
                        accountId:   t.accountId,
                        type:        "DEBIT" as const,
                        amount:      t.amount,
                        description: t.description ?? null,
                        branchId:    args.branchId ?? null,
                    })),
                    {
                        accountId:   args.customerAccountId,
                        type:        "CREDIT" as const,
                        amount:      total,
                        description: args.narration ?? null,
                        branchId:    args.branchId ?? null,
                    },
                ],
            },
        },
        select: { id: true },
    });

    await tx.voucher.update({
        where: { id: voucher.id },
        data:  { journalEntryId: je.id },
    });

    // 3. Account.balance deltas for every line.
    // Account.normalBalance is nullable on identity ledgers (person / company
    // accounts). Fall back to the group's natural side — debit for assets &
    // expenses, credit for liabilities/equity/income — so subsidiary AR / AP
    // ledgers update correctly. This mirrors `effectiveNormalBalance` in
    // postInvVoucher.ts.
    const accountIds = [...args.tenders.map((t) => t.accountId), args.customerAccountId];
    const accounts = await tx.account.findMany({
        where:  { id: { in: accountIds } },
        select: { id: true, normalBalance: true, group: { select: { type: true } } },
    });
    const normalById = new Map<number, "DEBIT" | "CREDIT">();
    for (const a of accounts) {
        const side = a.normalBalance
            ?? (a.group?.type ? defaultNormalBalanceForGroupType(a.group.type) : null);
        if (side) normalById.set(a.id, side);
    }

    for (const t of args.tenders) {
        const normal = normalById.get(t.accountId);
        if (!normal) continue;
        const delta = balanceDelta(normal, "DEBIT", toNumber(t.amount));
        await tx.account.update({
            where: { id: t.accountId },
            data:  { balance: { increment: delta } },
        });
    }
    const arNormal = normalById.get(args.customerAccountId);
    if (arNormal) {
        const delta = balanceDelta(arNormal, "CREDIT", total);
        await tx.account.update({
            where: { id: args.customerAccountId },
            data:  { balance: { increment: delta } },
        });
    }

    // 4. Bill-wise allocation against the originating InvVoucher JE(s).
    //    `allocations` (multi-bill FIFO) wins; else the single-target shortcut;
    //    else nothing (pure advance — the Cr to the customer stands as credit).
    const allocationPlan: { journalEntryId: number; amount: number }[] =
        args.allocations != null && args.allocations.length > 0
            ? args.allocations.filter((a) => a.amount > 0.005)
            : args.allocateToJournalEntryId != null
                ? [{ journalEntryId: args.allocateToJournalEntryId, amount: total }]
                : [];

    // Never allocate more than the receipt actually received — an over-allocation
    // would mis-state receivables; throwing here rolls back the whole transaction.
    const allocSum = allocationPlan.reduce((s, a) => s + a.amount, 0);
    if (allocSum > total + 0.01) {
        throw new Error(
            `Receipt allocation (₹${allocSum.toFixed(2)}) exceeds receipt total (₹${total.toFixed(2)}).`,
        );
    }

    const allocationIds: number[] = [];
    for (const a of allocationPlan) {
        const alloc = await tx.voucherAllocation.create({
            data: {
                targetType:  "JOURNAL_ENTRY",
                targetId:    a.journalEntryId,
                sourceType:  "VOUCHER",
                sourceId:    voucher.id,
                amount:      a.amount,
                method:      "AGAINST_REF",
                reference:   voucherRef,
                createdById: args.userId,
            },
            select: { id: true },
        });
        allocationIds.push(alloc.id);
    }

    return {
        voucherId:      voucher.id,
        voucherRef:     voucher.reference,
        journalEntryId: je.id,
        allocationId:   allocationIds[0] ?? null,
        allocationIds,
    };
}
