import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { nextRef } from "@/modules/accountancy/lib/balance";
import { invNextRef } from "@/modules/inventory/lib/stock";
import { postInvoiceJe } from "@/shared/lib/format/postInvoiceJe";
import { validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// POST /api/pos/sale
// Atomic POS sale — creates the Invoice + InvoiceLines, posts the AR/Revenue
// journal entry, then writes a parallel InvVoucher (type=SALE, status=POSTED)
// + InvVoucherLines + InvStockLedger entries and decrements InvProduct.stock.
//
// One transaction so day-book / customer ledger / stock all move together.
//
// We DO NOT call postInvVoucherToGl (that would re-debit AR / re-credit
// Revenue and double-post the GL). The InvVoucher only carries the stock
// side; its journalEntryId points at the Invoice's JE for traceability.

const lineSchema = z.object({
    productId:   z.number().int().positive(),
    description: z.string().trim().min(1),
    quantity:    z.number().positive(),
    unitPrice:   z.number().min(0),
    taxRate:     z.number().min(0).max(100).default(0),
});

const createSchema = z.object({
    accountId: z.number().int().positive(),
    issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dueDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    notes:     z.string().trim().optional(),
    lines:     z.array(lineSchema).min(1, "At least one line item required"),
});

export async function POST(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { data, error } = await validateRequest(req, createSchema);

    if (error) return error;
    const body = data;

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

            // ── 2. InvVoucher (type=SALE) + lines + stock ledger + cached stock ─
            const voucherRef = await invNextRef(tx, "SALE");
            const voucher = await tx.invVoucher.create({
                data: {
                    type:           "SALE",
                    reference:      voucherRef,
                    date:           new Date(body.issueDate),
                    description:    `POS sale ${invoiceNumber}`,
                    status:         "POSTED",
                    postedAt:       new Date(),
                    paymentMode:    "CASH", // POS-specific shorthand; payment-line breakdown is on the invoice notes
                    subtotal,
                    taxAmount,
                    totalAmount,
                    amountReceived: totalAmount, // POS sale always settles the inventory side immediately
                    journalEntryId: je.id,       // point at the Invoice's JE — no separate GL post
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
                        date,
                        inQty:  0,
                        outQty: qty,
                        rate:   line.rate,
                        amount: line.amount,
                    },
                });
                await tx.invProduct.update({
                    where: { id: line.productId },
                    data:  { stock: { decrement: Math.round(qty) } },
                });
            }

            return {
                invoiceId:      invoice.id,
                invoiceNumber:  invoice.number,
                journalEntryId: je.id,
                voucherId:      voucher.id,
                voucherRef:     voucher.reference,
            };
        });

        return NextResponse.json(result, { status: 201 });
    } catch (err) {
        console.error("[pos sale]", err);
        const msg = err instanceof Error ? err.message : "Failed to create POS sale";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
