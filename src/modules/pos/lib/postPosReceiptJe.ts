// ── postPosReceiptJe — close the AR side of a cash POS sale ──────────────────
//
// The plain Invoice JE created by `postInvoiceJe` only does:
//   Dr Accounts Receivable / Cr Revenue (+ Cr Tax Payable)
//
// For a POS sale where the customer hands over cash/UPI/card at the counter,
// AR should NOT linger forever — it gets settled immediately. This helper:
//
//   1. Creates a `Payment` row per payment-method line (links to invoice).
//   2. Creates a single cash-receipt `JournalEntry`:
//        • Dr <till / bank account>  (one DEBIT line per payment line)
//        • Cr Accounts Receivable    (total — closes the AR)
//   3. Updates Account.balance for each line.
//   4. Updates Invoice.amountPaid = totalAmount, status → PAID.
//
// CASH-method payments MUST debit the active shift's `tillAccountId`. Non-CASH
// methods debit whatever bank/wallet account the cashier picked at checkout.
// Both are passed in `payments[].accountId` by the caller — this helper does
// no auto-routing, keeping the contract simple.

import type { PaymentMethod, Prisma } from "@/generated/prisma/client";
import { balanceDelta, nextRefFromSeries, toNumber } from "@/modules/accountancy/lib/balance";

export type PosPaymentInput = {
    method:    PaymentMethod;
    accountId: number;            // cash till OR bank account
    amount:    number;            // rupees
    reference?: string;           // cheque #, UPI ref, etc.
};

export async function postPosReceiptJe(
    tx: Prisma.TransactionClient,
    args: {
        invoiceId:         number;
        invoiceNumber:     string;
        customerAccountId: number;            // the AR account being settled
        payments:          PosPaymentInput[];
        userId:            number;
        date:              Date;
    },
): Promise<{ journalEntryId: number; paymentIds: number[] }> {
    const totalAmount = args.payments.reduce((s, p) => s + p.amount, 0);
    if (totalAmount <= 0) throw new Error("Receipt has zero amount.");

    // Resolve AR account once — needed for the closing credit line.
    // We use the customer-specific AR account that the invoice debited
    // (Invoice.accountId), so the ledger nets to zero on this exact AR.

    // 1. Payment rows — one per method line. invoice.id is the legacy FK.
    const paymentIds: number[] = [];
    for (const p of args.payments) {
        const row = await tx.payment.create({
            data: {
                invoiceId:    args.invoiceId,
                amount:       p.amount,
                method:       p.method,
                reference:    p.reference ?? null,
                date:         args.date,
                status:       "POSTED",
                postedAt:     args.date,
                createdById:  args.userId,
                notes:        `POS receipt for ${args.invoiceNumber}`,
            },
            select: { id: true },
        });
        paymentIds.push(row.id);
    }

    // 2. Cash-receipt JE — debit each payment account, credit AR for total.
    const jeRef = await nextRefFromSeries(tx, "GL_POSTING", args.userId);
    const lines: Array<{ accountId: number; type: "DEBIT" | "CREDIT"; amount: number; description: string }> = [];
    for (const p of args.payments) {
        lines.push({
            accountId:   p.accountId,
            type:        "DEBIT",
            amount:      p.amount,
            description: `${p.method} receipt for ${args.invoiceNumber}`,
        });
    }
    lines.push({
        accountId:   args.customerAccountId,
        type:        "CREDIT",
        amount:      totalAmount,
        description: `Closes AR for ${args.invoiceNumber}`,
    });

    const je = await tx.journalEntry.create({
        data: {
            date:        args.date,
            reference:   jeRef,
            description: `POS receipt — ${args.invoiceNumber}`,
            status:      "POSTED",
            postedAt:    args.date,
            createdById: args.userId,
            lines: { create: lines.map((l) => ({ accountId: l.accountId, type: l.type, amount: l.amount, description: l.description })) },
        },
        select: { id: true },
    });

    // 3. Update Account.balance for each line.
    const accountIds = lines.map((l) => l.accountId);
    const accounts = await tx.account.findMany({
        where:  { id: { in: accountIds } },
        select: { id: true, normalBalance: true },
    });
    const normalById = new Map(accounts.map((a) => [a.id, a.normalBalance]));
    for (const line of lines) {
        const normal = normalById.get(line.accountId);
        if (!normal) continue;
        const delta = balanceDelta(normal, line.type, toNumber(line.amount));
        await tx.account.update({ where: { id: line.accountId }, data: { balance: { increment: delta } } });
    }

    // 4. Wire JE id on payments + mark invoice paid.
    if (paymentIds.length > 0) {
        await tx.payment.updateMany({
            where: { id: { in: paymentIds } },
            data:  { journalEntryId: je.id },
        });
    }
    await tx.invoice.update({
        where: { id: args.invoiceId },
        data: {
            amountPaid: totalAmount,
            status:     "PAID",
        },
    });

    return { journalEntryId: je.id, paymentIds };
}
