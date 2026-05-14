import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { nextRef } from "@/modules/accountancy/lib/balance";
import { invNextRef } from "@/modules/inventory/lib/stock";
import { postInvoiceJe } from "@/modules/accountancy/lib/postInvoiceJe";
import { postPosReceiptJe } from "@/modules/pos/lib/postPosReceiptJe";
import { validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
// Note: branch context comes from the cashier's active shift, NOT from the
// session cookie. This allows multiple browsers / users to bill in parallel
// from different counters without their active-branch cookie interfering.

// POST /api/pos/sale
//
// Atomic POS sale — creates the Invoice + InvoiceLines, posts the AR/Revenue
// journal entry, writes Payment rows + a cash-receipt JE that immediately
// closes the AR (Dr Cash/Bank / Cr AR), then writes the parallel InvVoucher
// (type=SALE, status=POSTED) + InvVoucherLines + InvStockLedger and
// decrements per-branch stock.
//
// As of 2026-05-14 the route requires the cashier to have an OPEN PosShift
// in the active branch. The CASH portion of any payment auto-debits the
// shift's tillAccountId; non-CASH portions debit the user-picked bank account.
// See docs/modules/pos.md.

const lineSchema = z.object({
    productId:   z.number().int().positive(),
    description: z.string().trim().min(1),
    quantity:    z.number().positive(),
    unitPrice:   z.number().min(0),
    taxRate:     z.number().min(0).max(100).default(0),
});

const paymentSchema = z.object({
    method:    z.enum(["CASH", "BANK_TRANSFER", "CARD", "CHEQUE", "MOBILE_PAYMENT", "OTHER"]),
    amount:    z.number().positive(),
    accountId: z.number().int().positive().optional(),   // required for non-CASH; CASH auto-routes to till
    reference: z.string().trim().max(120).optional(),
});

const createSchema = z.object({
    accountId: z.number().int().positive(),                                       // customer AR account
    issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dueDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    notes:     z.string().trim().optional(),
    lines:     z.array(lineSchema).min(1, "At least one line item required"),
    payments:  z.array(paymentSchema).min(1, "At least one payment line required"),
});

export async function POST(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { data, error } = await validateRequest(req, createSchema);
    if (error) return error;
    const body = data;

    // ── Active shift requirement ──────────────────────────────────────────
    // Branch context comes from the shift, not the session cookie.
    // This lets multiple users bill in parallel from different browsers
    // without their active-branch cookie interfering.
    const shift = await prisma.posShift.findFirst({
        where:  { userId: user!.id, status: "OPEN" },
        select: { id: true, branchId: true, counter: { select: { tillAccountId: true } } },
    });
    if (!shift) {
        return NextResponse.json(
            { error: "Open a shift before billing.", code: "NO_OPEN_SHIFT" },
            { status: 400 },
        );
    }
    const tillAccountId  = shift.counter.tillAccountId;
    const activeBranchId = shift.branchId;

    // ── Validate payment lines ────────────────────────────────────────────
    const computedLines = body.lines.map((l) => {
        const lineSubtotal = l.quantity * l.unitPrice;
        const lineTax = (lineSubtotal * l.taxRate) / 100;
        return {
            productId:   l.productId,
            description: l.description,
            quantity:    l.quantity,
            unitPrice:   l.unitPrice,
            taxRate:     l.taxRate,
            taxAmount:   lineTax,
            amount:      lineSubtotal + lineTax,
        };
    });
    const subtotal    = computedLines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    const taxAmount   = computedLines.reduce((s, l) => s + l.taxAmount, 0);
    const totalAmount = subtotal + taxAmount;

    const paymentTotal = body.payments.reduce((s, p) => s + p.amount, 0);
    if (Math.abs(paymentTotal - totalAmount) > 0.01) {
        return NextResponse.json(
            { error: `Payment total (₹${paymentTotal.toFixed(2)}) does not match invoice total (₹${totalAmount.toFixed(2)}).` },
            { status: 422 },
        );
    }

    // Auto-route CASH to till; require accountId on non-CASH methods.
    const resolvedPayments: { method: typeof body.payments[number]["method"]; accountId: number; amount: number; reference?: string }[] = [];
    for (const p of body.payments) {
        if (p.method === "CASH") {
            resolvedPayments.push({ method: "CASH", accountId: tillAccountId, amount: p.amount, reference: p.reference });
        } else {
            if (!p.accountId) {
                return NextResponse.json(
                    { error: `Non-cash payment (${p.method}) needs an account selected.` },
                    { status: 422 },
                );
            }
            resolvedPayments.push({ method: p.method, accountId: p.accountId, amount: p.amount, reference: p.reference });
        }
    }

    try {
        const result = await prisma.$transaction(async (tx) => {
            // ── 1. Invoice + InvoiceLines + AR/Revenue JE ─────────────────────
            const invoiceNumber = await nextRef(tx, "invoice", "INV");
            const invoice = await tx.invoice.create({
                data: {
                    number:      invoiceNumber,
                    status:      "SENT",
                    issueDate:   new Date(body.issueDate),
                    dueDate:     new Date(body.dueDate),
                    notes:       body.notes ?? null,
                    accountId:   body.accountId,
                    subtotal,
                    taxAmount,
                    totalAmount,
                    amountPaid:  0,
                    createdById: user!.id,
                    lines: {
                        create: computedLines.map((l) => ({
                            description: l.description,
                            quantity:    l.quantity,
                            unitPrice:   l.unitPrice,
                            taxRate:     l.taxRate,
                            taxAmount:   l.taxAmount,
                            amount:      l.amount,
                        })),
                    },
                },
            });

            const je = await postInvoiceJe(tx, invoice.id, invoiceNumber, subtotal, taxAmount, totalAmount, user!.id);

            // ── 2. Cash-receipt JE — closes the AR side immediately ──────────
            const receiptDate = new Date();
            const receipt = await postPosReceiptJe(tx, {
                invoiceId:         invoice.id,
                invoiceNumber,
                customerAccountId: body.accountId,
                payments:          resolvedPayments,
                userId:            user!.id,
                date:              receiptDate,
            });

            // ── 3. InvVoucher (type=SALE) + lines + stock ledger + cached stock ─
            const voucherRef = await invNextRef(tx, "SALE");
            const voucher = await tx.invVoucher.create({
                data: {
                    type:           "SALE",
                    reference:      voucherRef,
                    branchId:       activeBranchId,
                    date:           new Date(body.issueDate),
                    description:    `POS sale ${invoiceNumber}`,
                    status:         "POSTED",
                    postedAt:       new Date(),
                    paymentMode:    "CASH",
                    subtotal,
                    taxAmount,
                    totalAmount,
                    amountReceived: totalAmount,
                    journalEntryId: je.id,
                    createdById:    user!.id,
                    lines: {
                        create: computedLines.map((l) => ({
                            productId:   l.productId,
                            description: l.description,
                            quantity:    l.quantity,
                            rate:        l.unitPrice,
                            taxRate:     l.taxRate,
                            taxAmount:   l.taxAmount,
                            amount:      l.amount,
                        })),
                    },
                },
                include: { lines: true },
            });

            const date = new Date(body.issueDate);
            for (const line of voucher.lines) {
                const qty = Number(line.quantity);
                if (qty <= 0) continue;
                await tx.invStockLedger.create({
                    data: {
                        productId: line.productId,
                        voucherId: voucher.id,
                        branchId:  activeBranchId,
                        date,
                        inQty:  0,
                        outQty: qty,
                        rate:   line.rate,
                        amount: line.amount,
                    },
                });
                await tx.invProductBranch.upsert({
                    where:  { productId_branchId: { productId: line.productId, branchId: activeBranchId } },
                    create: { productId: line.productId, branchId: activeBranchId, stock: -Math.round(qty) },
                    update: { stock: { decrement: Math.round(qty) } },
                });
                await tx.invProduct.update({
                    where: { id: line.productId },
                    data:  { stock: { decrement: Math.round(qty) } },
                });
            }

            return {
                invoiceId:        invoice.id,
                invoiceNumber:    invoice.number,
                journalEntryId:   je.id,
                receiptJeId:      receipt.journalEntryId,
                paymentIds:       receipt.paymentIds,
                voucherId:        voucher.id,
                voucherRef:       voucher.reference,
                shiftId:          shift.id,
            };
        });

        return NextResponse.json(result, { status: 201 });
    } catch (err) {
        console.error("[pos sale]", err);
        const msg = err instanceof Error ? err.message : "Failed to create POS sale";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
