import { PrismaClient } from "@/generated/prisma/client";
import { fyStartYearFor } from "./voucherRef";

const KINDS = [
    { kind: "CONTRA",      label: "Contra Voucher",  typeValue: "CV",  voucherType: "CONTRA" as const },
    { kind: "PAYMENT",     label: "Payment Voucher", typeValue: "PV",  voucherType: "PAYMENT" as const },
    { kind: "RECEIPT",     label: "Receipt Voucher", typeValue: "RV",  voucherType: "RECEIPT" as const },
    { kind: "CREDIT_NOTE", label: "Credit Note",     typeValue: "CRN", voucherType: "CREDIT_NOTE" as const },
    { kind: "DEBIT_NOTE",  label: "Debit Note",      typeValue: "DRN", voucherType: "DEBIT_NOTE" as const },
] as const;

export async function seedVoucherSeries(prisma: PrismaClient) {
    // Ensure BooksConfig singleton exists (default Apr 1)
    const config = await prisma.booksConfig.upsert({
        where: { id: 1 },
        create: { id: 1, restartMonth: 4, restartDay: 1 },
        update: {},
    });
    const fyStart = fyStartYearFor(config.restartMonth, config.restartDay);

    // Count existing records per kind so the next reference continues from the
    // correct number (not from 1).
    const voucherCounts = await Promise.all(
        KINDS.map(async ({ kind, voucherType }) => {
            const count = await prisma.voucher.count({ where: { type: voucherType } });
            return { kind, count };
        }),
    );
    const jeCount = await prisma.journalEntry.count();
    const invCount = await prisma.invoice.count();

    const rows = [
        ...KINDS.map(({ kind, label, typeValue }) => ({
            kind,
            label,
            typeValue,
            nextSeq: voucherCounts.find((c) => c.kind === kind)?.count ?? 0,
        })),
        { kind: "JOURNAL", label: "Journal Entry", typeValue: "JE",  nextSeq: jeCount },
        { kind: "INVOICE", label: "Sales Invoice", typeValue: "INV", nextSeq: invCount },
    ].map((r) => ({
        kind:            r.kind,
        label:           r.label,
        fyStartYear:     fyStart,
        typeEnabled:     true,
        typeValue:       r.typeValue,
        userEnabled:     false,
        userMaxWidth:    3,
        yearEnabled:     true,
        yearFormat:      "FY_SHORT",
        startFrom:       1,
        padWidth:        4,
        nextSeq:         r.nextSeq,
        partOrder:       "type,-,year,-,number",
    }));

    await prisma.voucherSeries.createMany({ data: rows, skipDuplicates: true });
}
