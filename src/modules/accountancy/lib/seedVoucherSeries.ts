import { PrismaClient } from "@/generated/prisma/client";
import { fyStartYearFor } from "./voucherRef";

const KINDS = [
    { kind: "CONTRA",      label: "Contra Voucher",  typeValue: "CV",  voucherType: "CONTRA" as const },
    { kind: "PAYMENT",     label: "Payment Voucher", typeValue: "PMT", voucherType: "PAYMENT" as const },
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
    // Phase 5 5E: financial vouchers ARE spine rows now — count off the spine by type.
    const voucherCounts = await Promise.all(
        KINDS.map(async ({ kind, voucherType }) => {
            const count = await prisma.universalVoucher.count({ where: { type: voucherType } });
            return { kind, count };
        }),
    );
    // User-entered Journal Vouchers — counted from spine rows of type=JOURNAL.
    const userJournalCount = await prisma.universalVoucher.count({ where: { type: "JOURNAL" } });
    // Phase 5 5D-14: the GL_POSTING series is retired — the engine no longer mints a
    // separate GL-… reference (the spine `id` IS the Universal Voucher No since 5D-7).
    // Inventory voucher counts — needed for new-install continuity so the next
    // SV / PV / EV reference picks up where the legacy invNextRef left off.
    const saleCount     = await prisma.universalVoucher.count({ where: { type: "SALE" } });
    const posCount      = await prisma.universalVoucher.count({ where: { type: "POS" } });
    const purchaseCount = await prisma.universalVoucher.count({ where: { type: "PURCHASE" } });
    const estimateCount = await prisma.universalVoucher.count({ where: { type: "ESTIMATE" } });
    const saleReturnCount     = await prisma.universalVoucher.count({ where: { type: "SALE_RETURN" } });
    const purchaseReturnCount = await prisma.universalVoucher.count({ where: { type: "PURCHASE_RETURN" } });
    const salesOrderCount         = await prisma.universalVoucher.count({ where: { type: "SALES_ORDER" } });
    const purchaseOrderCount      = await prisma.universalVoucher.count({ where: { type: "PURCHASE_ORDER" } });
    const grnCount                = await prisma.universalVoucher.count({ where: { type: "GRN" } });
    const challanCount            = await prisma.universalVoucher.count({ where: { type: "CHALLAN" } });
    const manufacturingCount      = await prisma.universalVoucher.count({ where: { type: "MANUFACTURING_JOURNAL" } });
    const physicalStockCount      = await prisma.universalVoucher.count({ where: { type: "PHYSICAL_STOCK" } });
    const branchTransferCount     = await prisma.universalVoucher.count({ where: { type: "BRANCH_TRANSFER" } });
    const rejectionInCount        = await prisma.universalVoucher.count({ where: { type: "REJECTION_IN" } });
    const rejectionOutCount       = await prisma.universalVoucher.count({ where: { type: "REJECTION_OUT" } });

    const rows = [
        ...KINDS.map(({ kind, label, typeValue }) => ({
            kind,
            label,
            typeValue,
            nextSeq: voucherCounts.find((c) => c.kind === kind)?.count ?? 0,
        })),
        // User Journal Voucher (primary voucher) — prefix JV.
        { kind: "JOURNAL",     label: "Journal Voucher", typeValue: "JV", nextSeq: userJournalCount },
        // Phase 5 5D-14: GL_POSTING series removed — nothing mints a GL- reference.
        // Legacy "INVOICE" series (typeValue INV) was retired with the
        // Invoice → InvVoucher consolidation on 2026-05-24. SALE / POS
        // below cover the same surface with their own SV / POS prefixes.
        // Inventory vouchers — same FY-aware convention managed from
        // /office/settings/year-ending. invNextRef() routes through nextRefFromSeries
        // to read these rows on every save.
        { kind: "SALE",     label: "Sale Invoice",     typeValue: "SV",  nextSeq: saleCount },
        { kind: "POS",      label: "POS Sale",         typeValue: "POS", nextSeq: posCount },
        { kind: "PURCHASE", label: "Purchase Invoice", typeValue: "PV",  nextSeq: purchaseCount },
        { kind: "ESTIMATE", label: "Estimate",         typeValue: "EV", nextSeq: estimateCount },
        { kind: "SALE_RETURN",     label: "Sale Return",     typeValue: "SR", nextSeq: saleReturnCount },
        { kind: "PURCHASE_RETURN", label: "Purchase Return", typeValue: "PR", nextSeq: purchaseReturnCount },
        { kind: "SALES_ORDER",           label: "Sales Order",            typeValue: "SO",   nextSeq: salesOrderCount },
        { kind: "PURCHASE_ORDER",        label: "Purchase Order",         typeValue: "PO",   nextSeq: purchaseOrderCount },
        { kind: "GRN",                   label: "Goods Receipt Note",     typeValue: "GRN",  nextSeq: grnCount },
        { kind: "CHALLAN",               label: "Delivery Challan",       typeValue: "DC",   nextSeq: challanCount },
        { kind: "MANUFACTURING_JOURNAL", label: "Manufacturing Journal",  typeValue: "MJ",   nextSeq: manufacturingCount },
        { kind: "PHYSICAL_STOCK",        label: "Physical Stock",         typeValue: "PS",   nextSeq: physicalStockCount },
        { kind: "BRANCH_TRANSFER",       label: "Branch Transfer",        typeValue: "BT",   nextSeq: branchTransferCount },
        { kind: "REJECTION_IN",          label: "Rejection In",           typeValue: "RIN",  nextSeq: rejectionInCount },
        { kind: "REJECTION_OUT",         label: "Rejection Out",          typeValue: "ROUT", nextSeq: rejectionOutCount },
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

    // One-time typeValue migration: JOURNAL series used to emit `JE-…` which
    // collided visually with the engine's GL postings. Flip to `JV-` so the
    // user-facing Journal Voucher and the engine's GL posting have distinct
    // prefixes. Only touches rows still on the old default — admin overrides
    // are preserved.
    await prisma.voucherSeries.updateMany({
        where: { kind: "JOURNAL", typeValue: "JE" },
        data:  { typeValue: "JV" },
    });

    // One-time prefix migration: PAYMENT used to emit `PV-`, which collided with
    // PURCHASE invoices (also `PV-`). Harmless while they lived in separate tables,
    // but the merged universal-voucher spine needs ONE globally-unique voucher
    // number, so PAYMENT flips to `PMT-` (dummy data already used it). Only touches
    // rows still on the old default — admin overrides are preserved.
    await prisma.voucherSeries.updateMany({
        where: { kind: "PAYMENT", typeValue: "PV" },
        data:  { typeValue: "PMT" },
    });

    // Phase 5 5D-14: retire the orphaned GL_POSTING series — the engine stopped
    // minting GL- references (the spine `id` IS the Universal Voucher No since 5D-7).
    await prisma.voucherSeries.deleteMany({ where: { kind: "GL_POSTING" } });
}
