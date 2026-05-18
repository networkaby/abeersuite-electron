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
    // Inventory voucher counts — needed for new-install continuity so the next
    // SV / PV / EV reference picks up where the legacy invNextRef left off.
    const saleCount     = await prisma.invVoucher.count({ where: { type: "SALE" } });
    const posCount      = await prisma.invVoucher.count({ where: { type: "POS" } });
    const purchaseCount = await prisma.invVoucher.count({ where: { type: "PURCHASE" } });
    const estimateCount = await prisma.invVoucher.count({ where: { type: "ESTIMATE" } });
    const saleReturnCount     = await prisma.invVoucher.count({ where: { type: "SALE_RETURN" } });
    const purchaseReturnCount = await prisma.invVoucher.count({ where: { type: "PURCHASE_RETURN" } });

    const rows = [
        ...KINDS.map(({ kind, label, typeValue }) => ({
            kind,
            label,
            typeValue,
            nextSeq: voucherCounts.find((c) => c.kind === kind)?.count ?? 0,
        })),
        { kind: "JOURNAL", label: "Journal Entry", typeValue: "JE",  nextSeq: jeCount },
        { kind: "INVOICE", label: "Sales Invoice", typeValue: "INV", nextSeq: invCount },
        // Inventory vouchers — same FY-aware convention managed from
        // /office/admin/year-ending. invNextRef() routes through nextRefFromSeries
        // to read these rows on every save.
        { kind: "SALE",     label: "Sale Invoice",     typeValue: "SV",  nextSeq: saleCount },
        { kind: "POS",      label: "POS Sale",         typeValue: "POS", nextSeq: posCount },
        { kind: "PURCHASE", label: "Purchase Invoice", typeValue: "PV",  nextSeq: purchaseCount },
        { kind: "ESTIMATE", label: "Estimate",         typeValue: "EV", nextSeq: estimateCount },
        { kind: "SALE_RETURN",     label: "Sale Return",     typeValue: "SR", nextSeq: saleReturnCount },
        { kind: "PURCHASE_RETURN", label: "Purchase Return", typeValue: "PR", nextSeq: purchaseReturnCount },
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

    // Keep labels in sync — `skipDuplicates` above means existing rows don't
    // pick up label tweaks (e.g. "Sale Voucher" → "Sale Invoice"). Update
    // labels idempotently so renames propagate without a manual migration.
    await Promise.all(rows.map((r) =>
        prisma.voucherSeries.update({
            where: { kind: r.kind },
            data:  { label: r.label },
        }).catch(() => { /* ignore if row doesn't exist yet */ })
    ));
}
