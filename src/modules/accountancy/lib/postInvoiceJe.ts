import type { Prisma } from "@/generated/prisma/client";
import { nextRefFromSeries, balanceDelta } from "@/modules/accountancy/lib/balance";

/**
 * Post the accounts-receivable / revenue journal entry for an invoice.
 * Lives in src/lib so it can be imported from multiple route handlers
 * (Next.js route files may only export HTTP method handlers + runtime).
 */
export async function postInvoiceJe(
    tx: Prisma.TransactionClient,
    invoiceId: number,
    invoiceNumber: string,
    subtotal: number,
    taxAmount: number,
    totalAmount: number,
    userId: number,
) {
    const [ar, revenue, taxPayable] = await Promise.all([
        tx.account.findFirst({ where: { code: "1100" } }),
        tx.account.findFirst({ where: { code: "4000" } }),
        taxAmount > 0 ? tx.account.findFirst({ where: { code: "2100" } }) : Promise.resolve(null),
    ]);

    if (!ar || !revenue) {
        throw new Error("Required GL accounts not found (1100 AR, 4000 Revenue). Run the finance seed first.");
    }

    const jeRef = await nextRefFromSeries(tx, "GL_POSTING", userId);
    const lines: Prisma.JournalLineUncheckedCreateWithoutJournalEntryInput[] = [
        { accountId: ar.id, type: "DEBIT",  amount: totalAmount, description: `Invoice ${invoiceNumber}` },
        { accountId: revenue.id, type: "CREDIT", amount: subtotal, description: `Invoice ${invoiceNumber}` },
    ];
    if (taxAmount > 0 && taxPayable) {
        lines.push({ accountId: taxPayable.id, type: "CREDIT", amount: taxAmount, description: `Tax on ${invoiceNumber}` });
    }

    const je = await tx.journalEntry.create({
        data: {
            date: new Date(),
            reference: jeRef,
            description: `Invoice ${invoiceNumber}`,
            status: "POSTED",
            postedAt: new Date(),
            createdById: userId,
            lines: { create: lines },
        },
    });

    for (const line of lines) {
        const acct = await tx.account.findUnique({ where: { id: line.accountId } });
        if (!acct) continue;
        const delta = balanceDelta(acct.normalBalance!, line.type as "DEBIT" | "CREDIT", Number(line.amount));
        await tx.account.update({ where: { id: line.accountId }, data: { balance: { increment: delta } } });
    }

    void invoiceId; // currently unused but kept in the signature for future audit linking
    return je;
}
