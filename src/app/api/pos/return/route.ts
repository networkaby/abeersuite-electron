// POST /api/pos/return
//
// POS sale return — credit note + optional cash refund.
//
// Body: { originalInvoiceId, lines: [{invoiceLineId, qty}], refundMode, notes? }
//   refundMode "CASH"   — refunds cash from the counter till (requires OPEN shift)
//   refundMode "CREDIT" — leaves as a credit balance on the customer's AR account
//
// Steps (one $transaction):
//   1. Create a return Invoice (negative totalAmount, returnOfId → original).
//   2. Post return JE:
//        CASH   → Dr Sales Revenue / Cr Counter Till
//        CREDIT → Dr Sales Revenue / Cr Customer AR
//   3. Create SALE_RETURN InvVoucher + lines + stock-ledger entries (stock IN).
//   4. Increment InvProductBranch.stock + InvProduct.stock for returned items.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { nextRef, balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { invNextRef } from "@/modules/inventory/lib/stock";

const returnLineSchema = z.object({
    invoiceLineId: z.number().int().positive(),
    qty:           z.number().positive(),
});

const returnSchema = z.object({
    originalInvoiceId: z.number().int().positive(),
    lines:             z.array(returnLineSchema).min(1),
    refundMode:        z.enum(["CASH", "CREDIT"]),
    notes:             z.string().trim().max(500).optional(),
});

export async function POST(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.POS_SHIFT_OPEN);
    if (response) return response;

    const { data, error } = await validateRequest(req, returnSchema);
    if (error) return error;

    try {
        // ── Original invoice ─────────────────────────────────────────────────
        const original = await prisma.invoice.findUnique({
            where: { id: data.originalInvoiceId },
            include: {
                lines:   true,
                account: { select: { id: true, name: true } },
            },
        });
        if (!original) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
        if (original.status !== "PAID") {
            return NextResponse.json({ error: "Only fully paid invoices can be returned" }, { status: 409 });
        }
        if (original.returnOfId !== null) {
            return NextResponse.json({ error: "This invoice is itself a return — cannot return a return" }, { status: 409 });
        }
        if (!original.accountId) {
            return NextResponse.json({ error: "Invoice has no customer account linked" }, { status: 400 });
        }

        // ── Validate return lines ─────────────────────────────────────────────
        const lineMap = new Map(original.lines.map((l) => [l.id, l]));
        const returnLines: { invoiceLine: typeof original.lines[number]; qty: number }[] = [];
        for (const rl of data.lines) {
            const orig = lineMap.get(rl.invoiceLineId);
            if (!orig) return NextResponse.json({ error: `Line ${rl.invoiceLineId} not found on this invoice` }, { status: 400 });
            if (rl.qty > Number(orig.quantity)) {
                return NextResponse.json({ error: `Return qty ${rl.qty} exceeds original qty ${orig.quantity} on line "${orig.description}"` }, { status: 400 });
            }
            returnLines.push({ invoiceLine: orig, qty: rl.qty });
        }

        // ── Active shift (required for CASH refund) ───────────────────────────
        let tillAccountId: number | null = null;
        let shiftBranchId: string | null = null;
        const shift = await prisma.posShift.findFirst({
            where:  { userId: user!.id, status: "OPEN" },
            select: { id: true, branchId: true, counter: { select: { tillAccountId: true } } },
        });
        if (data.refundMode === "CASH") {
            if (!shift) {
                return NextResponse.json(
                    { error: "Open a shift before processing a cash refund.", code: "NO_OPEN_SHIFT" },
                    { status: 400 },
                );
            }
            tillAccountId = shift.counter.tillAccountId;
        }
        shiftBranchId = shift?.branchId ?? null;

        // ── Compute return totals ─────────────────────────────────────────────
        const returnSubtotal = returnLines.reduce((s, { invoiceLine, qty }) => {
            const unitPrice = Number(invoiceLine.unitPrice);
            return s + qty * unitPrice;
        }, 0);
        const returnTaxAmount = returnLines.reduce((s, { invoiceLine, qty }) => {
            const unitPrice = Number(invoiceLine.unitPrice);
            const taxRate   = Number(invoiceLine.taxRate);
            return s + (qty * unitPrice * taxRate) / 100;
        }, 0);
        const returnTotal = returnSubtotal + returnTaxAmount;

        // ── GL accounts ───────────────────────────────────────────────────────
        const [revenueAcct, arAcct] = await Promise.all([
            prisma.account.findFirst({ where: { code: "4000" } }),
            prisma.account.findFirst({ where: { id: original.accountId } }),
        ]);
        if (!revenueAcct) return NextResponse.json({ error: "Revenue account (code 4000) missing" }, { status: 500 });
        if (!arAcct)      return NextResponse.json({ error: "Customer AR account not found" }, { status: 500 });

        // ── Find original InvVoucher for stock reference ───────────────────────
        const originalVoucher = await prisma.invVoucher.findFirst({
            where: {
                type:        "POS",
                description: { contains: original.number },
                status:      "POSTED",
            },
            select: { id: true, branchId: true },
        });

        const branchId = shiftBranchId ?? originalVoucher?.branchId ?? null;

        // ── Transaction ───────────────────────────────────────────────────────
        const result = await prisma.$transaction(async (tx) => {
            const today = new Date();

            // 1. Create return Invoice (negative amounts).
            const returnNumber = await nextRef(tx, "invoice", "RTN");
            const returnInvoice = await tx.invoice.create({
                data: {
                    number:      returnNumber,
                    status:      "PAID",       // credit note is immediately settled
                    issueDate:   today,
                    dueDate:     today,
                    notes:       `Return of ${original.number}${data.notes ? ` — ${data.notes}` : ""}`,
                    accountId:   original.accountId,
                    returnOfId:  original.id,
                    subtotal:    -returnSubtotal,
                    taxAmount:   -returnTaxAmount,
                    totalAmount: -returnTotal,
                    amountPaid:  -returnTotal,
                    createdById: user!.id,
                    lines: {
                        create: returnLines.map(({ invoiceLine, qty }) => {
                            const lineSubtotal = qty * Number(invoiceLine.unitPrice);
                            const lineTax      = (lineSubtotal * Number(invoiceLine.taxRate)) / 100;
                            return {
                                productId:   invoiceLine.productId,
                                description: invoiceLine.description,
                                quantity:    -qty,
                                unitPrice:   Number(invoiceLine.unitPrice),
                                taxRate:     Number(invoiceLine.taxRate),
                                taxAmount:   -lineTax,
                                amount:      -(lineSubtotal + lineTax),
                            };
                        }),
                    },
                },
                select: { id: true, number: true },
            });

            // 2. Return JE.
            const jeRef = await nextRef(tx, "journalEntry", "JE");
            // CASH:   Dr Revenue / Cr Till
            // CREDIT: Dr Revenue / Cr AR
            const creditAccountId = data.refundMode === "CASH" ? tillAccountId! : arAcct.id;
            const jeLines = [
                { accountId: revenueAcct.id,  type: "DEBIT"  as const, amount: returnTotal, description: `Sale return ${returnNumber} (reversal of ${original.number})` },
                { accountId: creditAccountId,  type: "CREDIT" as const, amount: returnTotal, description: `${data.refundMode === "CASH" ? "Cash refund from till" : "Credit note"} — ${returnNumber}` },
            ];
            const je = await tx.journalEntry.create({
                data: {
                    date:        today,
                    reference:   jeRef,
                    description: `Sale return — ${returnNumber} (${original.number})`,
                    status:      "POSTED",
                    postedAt:    today,
                    createdById: user!.id,
                    lines: { create: jeLines },
                },
                select: { id: true, reference: true },
            });
            // Update balances.
            const accts = await tx.account.findMany({
                where:  { id: { in: [revenueAcct.id, creditAccountId] } },
                select: { id: true, normalBalance: true },
            });
            const normalById = new Map(accts.map((a) => [a.id, a.normalBalance]));
            for (const line of jeLines) {
                const normal = normalById.get(line.accountId)!;
                const delta  = balanceDelta(normal, line.type, toNumber(line.amount));
                await tx.account.update({ where: { id: line.accountId }, data: { balance: { increment: delta } } });
            }

            // 3. SALE_RETURN InvVoucher + stock reversal (only for lines with productId).
            let returnVoucherId: number | null = null;
            const stockLines = returnLines.filter((rl) => rl.invoiceLine.productId !== null);
            if (stockLines.length > 0 && branchId) {
                const vRef = await invNextRef(tx, "SALE_RETURN");
                const rv = await tx.invVoucher.create({
                    data: {
                        type:          "SALE_RETURN",
                        reference:     vRef,
                        branchId,
                        date:          today,
                        description:   `Sale return ${returnNumber} (${original.number})`,
                        status:        "POSTED",
                        postedAt:      today,
                        refNumber:     original.number,
                        refVoucherId:  originalVoucher?.id ?? null,
                        paymentMode:   data.refundMode,
                        subtotal:      returnSubtotal,
                        taxAmount:     returnTaxAmount,
                        totalAmount:   returnTotal,
                        amountReceived: data.refundMode === "CASH" ? returnTotal : 0,
                        journalEntryId: je.id,
                        createdById:   user!.id,
                        lines: {
                            create: stockLines.map(({ invoiceLine, qty }) => ({
                                productId:   invoiceLine.productId!,
                                description: invoiceLine.description,
                                quantity:    qty,
                                rate:        Number(invoiceLine.unitPrice),
                                taxRate:     Number(invoiceLine.taxRate),
                                taxAmount:   (qty * Number(invoiceLine.unitPrice) * Number(invoiceLine.taxRate)) / 100,
                                amount:      qty * Number(invoiceLine.unitPrice),
                            })),
                        },
                    },
                    select: { id: true },
                });
                returnVoucherId = rv.id;

                // Stock IN for each returned product.
                for (const { invoiceLine, qty } of stockLines) {
                    const productId = invoiceLine.productId!;
                    const rate      = Number(invoiceLine.unitPrice);
                    await tx.invStockLedger.create({
                        data: {
                            productId,
                            voucherId: rv.id,
                            branchId,
                            date:   today,
                            inQty:  qty,
                            outQty: 0,
                            rate,
                            amount: qty * rate,
                        },
                    });
                    await tx.invProductBranch.upsert({
                        where:  { productId_branchId: { productId, branchId } },
                        create: { productId, branchId, stock: Math.round(qty) },
                        update: { stock: { increment: Math.round(qty) } },
                    });
                    await tx.invProduct.update({
                        where: { id: productId },
                        data:  { stock: { increment: Math.round(qty) } },
                    });
                }
            }

            return {
                returnInvoiceId:  returnInvoice.id,
                returnNumber:     returnInvoice.number,
                journalEntryRef:  je.reference,
                returnVoucherId,
                returnTotal,
            };
        });

        return NextResponse.json(result, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to process return");
    }
}
