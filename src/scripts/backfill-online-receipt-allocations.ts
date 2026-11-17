// Repair the advance-receipt allocations on online invoices raised before the C1
// fix (`7f566504`, audit C1).
//
// From 2026-07-22 (`f6ca24a8`) until that fix, the invoice route looked the order's
// `receiptVoucherId` — a UniversalVoucher SPINE id — up in `voucherDetail`, which
// holds only inventory documents. A RECEIPT has no row there, so one of two things
// happened on every paid online order:
//
//   • the lookup missed  → NO allocation was written at all. The invoice stayed
//     open and the customer's advance stayed unapplied, overstating receivables.
//   • the id collided with an unrelated VoucherDetail (the two tables have
//     independent id sequences) → an allocation was written with the RIGHT source
//     and target but that stranger's `totalAmount` and `voucherNo`.
//
// The source and target ids were always correct, so the repair is small: create the
// missing allocations, and correct the amount/reference on the wrong ones.
//
// Correct amount = min(Σ receipt DEBIT legs, invoice total). Same rule the fixed
// route now applies via `voucherDebitTotal`.
//
//   pnpm backfill:receipt-allocations          report only, writes nothing (exit 1 if any)
//   pnpm backfill:receipt-allocations --fix    apply the repairs
//
// Idempotent: a second run reports OK for everything the first run wrote. Safe on
// live — it only ever touches allocations whose source is a POSTED RECEIPT spine
// that an ONLINE_INVOICE points at.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const rawUrl = (process.env.DIRECT_URL_1 ?? process.env.DATABASE_URL_1 ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
const isLocalDb = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(rawUrl);
const pool = new Pool({ connectionString: rawUrl, ssl: isLocalDb ? false : { rejectUnauthorized: false }, max: 2 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const FIX = process.argv.includes("--fix");
const n = (v: unknown) => Number(v ?? 0);
const round2 = (v: number) => Math.round(v * 100) / 100;
const EPS = 0.005;

type Verdict = "OK" | "MISSING" | "WRONG_AMOUNT" | "SKIPPED";

type Row = {
    verdict: Verdict;
    orderId: number;
    invoiceSpineId: number;
    invoiceNo: string | null;
    receiptSpineId: number;
    correct: number;
    found: number | null;
    note?: string;
};

async function main(): Promise<void> {
    if (!rawUrl) throw new Error("No DIRECT_URL or DATABASE_URL in the environment.");

    // Every posted online invoice, with the shop order it was raised from.
    const invoices = await prisma.universalVoucher.findMany({
        where: { type: "ONLINE_INVOICE", status: "POSTED" },
        select: {
            id: true,
            voucherNo: true,
            createdById: true,                        // the repair is attributed to whoever raised the invoice
            voucherDetail: { select: { totalAmount: true } },
            links: { where: { kind: "SHOP_ORDER" }, select: { targetId: true } },
        },
        orderBy: { id: "asc" },
    });

    const rows: Row[] = [];

    for (const inv of invoices) {
        const orderId = Number(inv.links[0]?.targetId);
        if (!orderId) continue;                       // no shop-order link: not ours to touch

        const order = await prisma.ticketOrder.findUnique({
            where: { ticketId: orderId },
            select: { shippingAddress: true },
        });
        const addr = (order?.shippingAddress ?? {}) as { receiptVoucherId?: unknown };
        const receiptSpineId = Number(addr.receiptVoucherId) || 0;
        if (!receiptSpineId) continue;                // COD / unpaid: there is no advance to apply

        const base = { orderId, invoiceSpineId: inv.id, invoiceNo: inv.voucherNo, receiptSpineId };

        // The receipt must be a real posted RECEIPT spine. Anything else is a stale or
        // wrong stamp on the order — report it, never guess at it.
        const receipt = await prisma.universalVoucher.findFirst({
            where: { id: receiptSpineId, type: "RECEIPT", status: "POSTED" },
            select: { voucherNo: true },
        });
        if (!receipt) {
            rows.push({ ...base, verdict: "SKIPPED", correct: 0, found: null,
                note: "receiptVoucherId is not a posted RECEIPT spine — needs a human look" });
            continue;
        }

        const debit = await prisma.voucherGlLine.aggregate({
            where: { universalVoucherId: receiptSpineId, type: "DEBIT" },
            _sum: { amount: true },
        });
        const receiptTotal = round2(n(debit._sum.amount));
        const invoiceTotal = round2(n(inv.voucherDetail?.totalAmount));
        const correct = round2(Math.min(receiptTotal, invoiceTotal));

        // Did this receipt get spent on some other live voucher? Then it is not a
        // missing allocation, it is a conflict — leave it alone and say so.
        const elsewhere = await prisma.voucherAllocation.findFirst({
            where: {
                sourceType: "VOUCHER", sourceId: receiptSpineId,
                targetType: "UNIVERSAL_VOUCHER", targetId: { not: inv.id },
            },
            select: { targetId: true },
        });

        const existing = await prisma.voucherAllocation.findFirst({
            where: {
                sourceType: "VOUCHER", sourceId: receiptSpineId,
                targetType: "UNIVERSAL_VOUCHER", targetId: inv.id,
            },
            select: { id: true, amount: true },
        });

        if (!existing && elsewhere) {
            rows.push({ ...base, verdict: "SKIPPED", correct, found: null,
                note: `receipt is already allocated to voucher ${elsewhere.targetId} — needs a human look` });
            continue;
        }

        const reference = receipt.voucherNo ?? `RCPT-${receiptSpineId}`;

        if (!existing) {
            // A zero-value receipt with no allocation is already correct, not missing.
            if (correct <= EPS) { rows.push({ ...base, verdict: "OK", correct, found: null }); continue; }
            rows.push({ ...base, verdict: "MISSING", correct, found: null });
            if (FIX) {
                await prisma.voucherAllocation.create({
                    data: {
                        targetType: "UNIVERSAL_VOUCHER", targetId: inv.id,
                        sourceType: "VOUCHER", sourceId: receiptSpineId,
                        amount: correct, method: "AGAINST_REF", reference,
                        createdById: inv.createdById,
                    },
                });
            }
            continue;
        }

        const found = round2(n(existing.amount));
        if (Math.abs(found - correct) <= EPS) {
            rows.push({ ...base, verdict: "OK", correct, found });
            continue;
        }

        rows.push({ ...base, verdict: "WRONG_AMOUNT", correct, found });
        if (FIX) {
            await prisma.voucherAllocation.update({
                where: { id: existing.id },
                data: { amount: correct, reference },
            });
        }
    }

    report(rows);
}

function report(rows: Row[]): void {
    const by = (v: Verdict) => rows.filter((r) => r.verdict === v);
    const missing = by("MISSING"), wrong = by("WRONG_AMOUNT"), skipped = by("SKIPPED"), ok = by("OK");

    const line = (r: Row) =>
        `  order #${r.orderId}  invoice ${r.invoiceNo ?? r.invoiceSpineId}  receipt spine ${r.receiptSpineId}` +
        (r.found === null ? `  → ₹${r.correct.toFixed(2)}` : `  ₹${r.found.toFixed(2)} → ₹${r.correct.toFixed(2)}`) +
        (r.note ? `  — ${r.note}` : "");

    console.log(`\nOnline invoices with an advance receipt: ${rows.length}`);
    console.log(`  already correct : ${ok.length}`);
    console.log(`  missing         : ${missing.length}`);
    console.log(`  wrong amount    : ${wrong.length}`);
    console.log(`  needs a look    : ${skipped.length}`);

    if (missing.length) { console.log(`\nMISSING allocation — the advance was never applied:`); missing.forEach((r) => console.log(line(r))); }
    if (wrong.length)   { console.log(`\nWRONG amount — allocated from an unrelated voucher's total:`); wrong.forEach((r) => console.log(line(r))); }
    if (skipped.length) { console.log(`\nSKIPPED — not repaired automatically:`); skipped.forEach((r) => console.log(line(r))); }

    const repairable = missing.length + wrong.length;
    if (!repairable && !skipped.length) { console.log(`\n✓ Every online invoice's advance is allocated correctly.\n`); return; }

    if (FIX) console.log(`\n✓ Repaired ${repairable} allocation(s).${skipped.length ? ` ${skipped.length} left for a human.` : ""}\n`);
    else     console.log(`\nReport only — nothing was written. Re-run with --fix to apply.\n`);

    if (!FIX && repairable) process.exitCode = 1;
}

main()
    .catch((e: unknown) => { console.error(e); process.exitCode = 1; })
    .finally(async () => { await prisma.$disconnect(); await pool.end(); });
