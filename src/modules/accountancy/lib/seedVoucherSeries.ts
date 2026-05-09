import { PrismaClient } from "@/generated/prisma/client";

const KINDS = [
    { kind: "CONTRA",      label: "Contra Voucher",   voucherType: "CONTRA" as const },
    { kind: "PAYMENT",     label: "Payment Voucher",   voucherType: "PAYMENT" as const },
    { kind: "RECEIPT",     label: "Receipt Voucher",   voucherType: "RECEIPT" as const },
    { kind: "CREDIT_NOTE", label: "Credit Note",       voucherType: "CREDIT_NOTE" as const },
    { kind: "DEBIT_NOTE",  label: "Debit Note",        voucherType: "DEBIT_NOTE" as const },
] as const;

const PREFIX_MAP: Record<string, string> = {
    CONTRA:      "CV",
    PAYMENT:     "PV",
    RECEIPT:     "RV",
    CREDIT_NOTE: "CRN",
    DEBIT_NOTE:  "DRN",
};

export async function seedVoucherSeries(prisma: PrismaClient) {
    const year = new Date().getFullYear();

    // Count existing vouchers per type for seamless continuity
    const voucherCounts = await Promise.all(
        KINDS.map(async ({ kind, voucherType }) => {
            const prefix = `${PREFIX_MAP[kind]}-${year}-`;
            const count = await prisma.voucher.count({
                where: { type: voucherType, reference: { startsWith: prefix } },
            });
            return { kind, count, prefix };
        }),
    );

    const jePrefix = `JE-${year}-`;
    const jeCount = await prisma.journalEntry.count({
        where: { reference: { startsWith: jePrefix } },
    });

    const invPrefix = `INV-${year}-`;
    const invCount = await prisma.invoice.count({
        where: { number: { startsWith: invPrefix } },
    });

    const rows = [
        ...voucherCounts.map(({ kind, count, prefix }) => ({
            kind,
            label: KINDS.find((k) => k.kind === kind)!.label,
            prefix,
            suffix: "",
            startFrom: 1,
            padWidth: 4,
            nextSeq: count,
        })),
        {
            kind: "JOURNAL",
            label: "Journal Entry",
            prefix: jePrefix,
            suffix: "",
            startFrom: 1,
            padWidth: 4,
            nextSeq: jeCount,
        },
        {
            kind: "INVOICE",
            label: "Sales Invoice",
            prefix: invPrefix,
            suffix: "",
            startFrom: 1,
            padWidth: 4,
            nextSeq: invCount,
        },
    ];

    await prisma.voucherSeries.createMany({ data: rows, skipDuplicates: true });
}
