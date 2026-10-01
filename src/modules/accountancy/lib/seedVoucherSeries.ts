import { PrismaClient } from "@/generated/prisma/client";
import { fyStartYearFor } from "./voucherRef";

const KINDS = [
    { kind: "CONTRA",      label: "Contra Voucher",  typeValue: "CV",  voucherType: "CONTRA" as const },
    { kind: "PAYMENT",     label: "Payment Voucher", typeValue: "PMT", voucherType: "PAYMENT" as const },
    { kind: "RECEIPT",     label: "Receipt Voucher", typeValue: "RV",  voucherType: "RECEIPT" as const },
    { kind: "CREDIT_NOTE", label: "Credit Note",     typeValue: "CRN", voucherType: "CREDIT_NOTE" as const },
    { kind: "DEBIT_NOTE",  label: "Debit Note",      typeValue: "DRN", voucherType: "DEBIT_NOTE" as const },
] as const;

/**
 * Create-or-relabel only: BooksConfig singleton, every series row, its counter-1 row,
 * and label sync. Never deletes. This is what the Voucher Series page may run on
 * every open, so a newly-added kind appears without a seed — Vercel runs migrations
 * on deploy but no seed, so this is how the live DB learns a new kind.
 *
 * The one-time fixups (prefix migrations, retiring GL_POSTING) live in
 * `seedVoucherSeries` below and run from the seed scripts only: migration-style work
 * has no place in a GET, and a counter's replica guard refuses every delete — even one
 * matching nothing — which took the Year Ending page down on a local-write till.
 */
export async function ensureVoucherSeries(prisma: PrismaClient) {
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
            const count = await prisma.universalVoucher.count({ where: { type: voucherType, voucherNo: { not: null } } });
            return { kind, count };
        }),
    );
    // Counting only NUMBERED rows. A voucher takes its number when it posts, so
    // a draft has none — counting drafts would push `nextSeq` past numbers that
    // were never issued and leave a gap on the very first post after a seed.
    // User-entered Journal Vouchers — counted from spine rows of type=JOURNAL.
    const userJournalCount = await prisma.universalVoucher.count({ where: { type: "JOURNAL", voucherNo: { not: null } } });
    // Phase 5 5D-14: the GL_POSTING series is retired — the engine no longer mints a
    // separate GL-… reference (the spine `id` IS the Universal Voucher No since 5D-7).
    // Inventory voucher counts — needed for new-install continuity so the next
    // SV / PV / EV reference picks up where the legacy invNextRef left off.
    const saleCount     = await prisma.universalVoucher.count({ where: { type: "SALE", voucherNo: { not: null } } });
    const posCount      = await prisma.universalVoucher.count({ where: { type: "POS", voucherNo: { not: null } } });
    const onlineInvoiceCount = await prisma.universalVoucher.count({ where: { type: "ONLINE_INVOICE", voucherNo: { not: null } } });
    const onlineOrderCount   = await prisma.universalVoucher.count({ where: { type: "ONLINE_ORDER", voucherNo: { not: null } } });
    const purchaseCount = await prisma.universalVoucher.count({ where: { type: "PURCHASE", voucherNo: { not: null } } });
    const estimateCount = await prisma.universalVoucher.count({ where: { type: "ESTIMATE", voucherNo: { not: null } } });
    const saleReturnCount     = await prisma.universalVoucher.count({ where: { type: "SALE_RETURN", voucherNo: { not: null } } });
    const purchaseReturnCount = await prisma.universalVoucher.count({ where: { type: "PURCHASE_RETURN", voucherNo: { not: null } } });
    const salesOrderCount         = await prisma.universalVoucher.count({ where: { type: "SALES_ORDER", voucherNo: { not: null } } });
    const purchaseOrderCount      = await prisma.universalVoucher.count({ where: { type: "PURCHASE_ORDER", voucherNo: { not: null } } });
    const grnCount                = await prisma.universalVoucher.count({ where: { type: "GRN", voucherNo: { not: null } } });
    const challanCount            = await prisma.universalVoucher.count({ where: { type: "CHALLAN", voucherNo: { not: null } } });
    const manufacturingCount      = await prisma.universalVoucher.count({ where: { type: "MANUFACTURING_JOURNAL", voucherNo: { not: null } } });
    const physicalStockCount      = await prisma.universalVoucher.count({ where: { type: "PHYSICAL_STOCK", voucherNo: { not: null } } });
    const branchTransferCount     = await prisma.universalVoucher.count({ where: { type: "BRANCH_TRANSFER", voucherNo: { not: null } } });
    const rejectionInCount        = await prisma.universalVoucher.count({ where: { type: "REJECTION_IN", voucherNo: { not: null } } });
    const rejectionOutCount       = await prisma.universalVoucher.count({ where: { type: "REJECTION_OUT", voucherNo: { not: null } } });
    const repairTicketCount       = await prisma.ticketRepair.count();

    const plan = [
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
        { kind: "ONLINE_INVOICE", label: "Online Invoice", typeValue: "OI", nextSeq: onlineInvoiceCount },
        { kind: "ONLINE_ORDER",   label: "Online Order",   typeValue: "OO", nextSeq: onlineOrderCount },
        { kind: "PURCHASE", label: "Purchase Invoice", typeValue: "PV",  nextSeq: purchaseCount },
        { kind: "ESTIMATE", label: "Estimate",         typeValue: "EV", nextSeq: estimateCount },
        // POS estimates / orders numbered by count(+1) under a different format
        // until B3a, so their series starts fresh — no number can repeat.
        { kind: "POS_ESTIMATE", label: "POS Estimate", typeValue: "POSEV", nextSeq: 0 },
        { kind: "POS_ORDER",    label: "POS Order",    typeValue: "POSOD", nextSeq: 0 },
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
        { kind: "REPAIR_TICKET",         label: "Service Repair Ticket",  typeValue: "RT",   nextSeq: repairTicketCount },
    ];
    const rows = plan.map((r) => ({
        kind:            r.kind,
        label:           r.label,
        fyStartYear:     fyStart,
        typeEnabled:     true,
        typeValue:       r.typeValue,
        counterEnabled:  true,
        yearEnabled:     true,
        yearFormat:      "FY_SHORT_SLASH",
        startFrom:       1,
        padWidth:        4,
        partOrder:       "type,-,year,-,counter,number",
    }));

    await prisma.voucherSeries.createMany({ data: rows, skipDuplicates: true });

    // The number lives per counter (VoucherSeriesCounter). Counter 1 — the office —
    // starts after the vouchers already numbered so numbering continues; other
    // counters create their own row on first use. Idempotent: existing rows are
    // never touched.
    await prisma.voucherSeriesCounter.createMany({
        data: plan.map((r) => ({ kind: r.kind, counterNumber: 1, nextSeq: r.nextSeq, fyStartYear: fyStart })),
        skipDuplicates: true,
    });

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

/**
 * The seed-script entry (bootstrap-seed, codeOwnedCatalog): ensure the rows, then
 * apply the one-time fixups. Idempotent — every fixup matches nothing on a DB that
 * already carries it.
 */
export async function seedVoucherSeries(prisma: PrismaClient) {
    await ensureVoucherSeries(prisma);

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
    await prisma.voucherSeriesCounter.deleteMany({ where: { kind: "GL_POSTING" } });
    await prisma.voucherSeries.deleteMany({ where: { kind: "GL_POSTING" } });
}
