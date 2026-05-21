// POST /api/pos/return/lost
//
// Manager-only "lost invoice" return. Customer lost the original bill but is
// in the system — the manager picks products + qty + unit price free-form,
// types a reason, and we post the same GL + stock reversal as a normal return
// (no link to an original Invoice or InvVoucher).
//
// Walk-ins are blocked: customerAccountId is required.
//
// GL:  CASH refund   → Dr Sales Revenue / Cr Counter Till  (requires OPEN shift)
//      CREDIT note   → Dr Sales Revenue / Cr Customer AR
// Stock: SALE_RETURN InvVoucher (refVoucherId=null) + InvStockLedger + branch/global stock + 1

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { nextRef, nextRefFromSeries, balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { invNextRef } from "@/modules/inventory/lib/stock";

const lostLineSchema = z.object({
    productId: z.number().int().positive(),
    qty:       z.number().positive(),
    unitPrice: z.number().min(0),
    taxRate:   z.number().min(0).max(100).default(0),
});

const lostSchema = z.object({
    customerAccountId: z.number().int().positive(),
    lines:             z.array(lostLineSchema).min(1),
    refundMode:        z.enum(["CASH", "CREDIT"]),
    reason:            z.string().trim().min(5, "Reason must be at least 5 characters").max(500),
});

export async function POST(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.POS_SHIFT_MANAGE);
    if (response) return response;

    const { data, error } = await validateRequest(req, lostSchema);
    if (error) return error;

    try {
        // ── Customer account ─────────────────────────────────────────────────
        const customerAcct = await prisma.account.findUnique({
            where:  { id: data.customerAccountId },
            select: { id: true, name: true },
        });
        if (!customerAcct) return NextResponse.json({ error: "Customer account not found" }, { status: 404 });

        // ── Products (resolve existence + names) ─────────────────────────────
        const productIds = data.lines.map((l) => l.productId);
        const products = await prisma.invProduct.findMany({
            where:  { id: { in: productIds } },
            select: { id: true, name: true, sku: true },
        });
        const productById = new Map(products.map((p) => [p.id, p]));
        for (const l of data.lines) {
            if (!productById.has(l.productId)) {
                return NextResponse.json({ error: `Product #${l.productId} not found` }, { status: 400 });
            }
        }

        // ── Active shift (required for CASH refund + supplies branch context) ─
        const shift = await prisma.posShift.findFirst({
            where:  { userId: user!.id, status: "OPEN" },
            select: { id: true, branchId: true, counter: { select: { tillAccountId: true } } },
        });
        let tillAccountId: number | null = null;
        if (data.refundMode === "CASH") {
            if (!shift) {
                return NextResponse.json(
                    { error: "Open a shift before processing a cash refund.", code: "NO_OPEN_SHIFT" },
                    { status: 400 },
                );
            }
            tillAccountId = shift.counter.tillAccountId;
        }
        const branchId = shift?.branchId ?? null;
        if (!branchId) {
            return NextResponse.json({ error: "Manager must have an open shift (provides the branch context for stock return)." }, { status: 400 });
        }

        // ── Compute totals ───────────────────────────────────────────────────
        const subtotal = data.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
        const taxAmt   = data.lines.reduce((s, l) => s + (l.qty * l.unitPrice * l.taxRate) / 100, 0);
        const total    = subtotal + taxAmt;
        if (total <= 0) return NextResponse.json({ error: "Return total must be > 0" }, { status: 400 });

        // ── GL accounts ──────────────────────────────────────────────────────
        const revenueAcct = await prisma.account.findFirst({ where: { code: "4000" } });
        if (!revenueAcct) return NextResponse.json({ error: "Revenue account (code 4000) missing" }, { status: 500 });

        // ── Transaction ──────────────────────────────────────────────────────
        const result = await prisma.$transaction(async (tx) => {
            const today = new Date();

            // 1. Return Invoice (no `returnOfId`, reason in notes).
            const returnNumber = await nextRef(tx, "invoice", "RTN");
            const returnInvoice = await tx.invoice.create({
                data: {
                    number:      returnNumber,
                    status:      "PAID",
                    issueDate:   today,
                    dueDate:     today,
                    notes:       `[LOST INVOICE] ${data.reason}`,
                    accountId:   customerAcct.id,
                    returnOfId:  null,
                    subtotal:    -subtotal,
                    taxAmount:   -taxAmt,
                    totalAmount: -total,
                    amountPaid:  -total,
                    createdById: user!.id,
                    lines: {
                        create: data.lines.map((l) => {
                            const lineSubtotal = l.qty * l.unitPrice;
                            const lineTax      = (lineSubtotal * l.taxRate) / 100;
                            const p = productById.get(l.productId)!;
                            return {
                                productId:   l.productId,
                                description: `${p.sku} — ${p.name}`,
                                quantity:    -l.qty,
                                unitPrice:   l.unitPrice,
                                taxRate:     l.taxRate,
                                taxAmount:   -lineTax,
                                amount:      -(lineSubtotal + lineTax),
                            };
                        }),
                    },
                },
                select: { id: true, number: true },
            });

            // 2. Return JE.
            const jeRef = await nextRefFromSeries(tx, "GL_POSTING", user!.id);
            const creditAccountId = data.refundMode === "CASH" ? tillAccountId! : customerAcct.id;
            const jeLines = [
                { accountId: revenueAcct.id,  type: "DEBIT"  as const, amount: total, description: `Lost-invoice return ${returnNumber}` },
                { accountId: creditAccountId, type: "CREDIT" as const, amount: total, description: `${data.refundMode === "CASH" ? "Cash refund from till" : "Credit note"} — ${returnNumber}` },
            ];
            const je = await tx.journalEntry.create({
                data: {
                    date:        today,
                    reference:   jeRef,
                    description: `Lost-invoice sale return — ${returnNumber}`,
                    status:      "POSTED",
                    postedAt:    today,
                    createdById: user!.id,
                    lines: { create: jeLines },
                },
                select: { id: true, reference: true },
            });
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

            // 3. SALE_RETURN InvVoucher + stock IN.
            const vRef = await invNextRef(tx, "SALE_RETURN");
            const rv = await tx.invVoucher.create({
                data: {
                    type:           "SALE_RETURN",
                    reference:      vRef,
                    branchId,
                    date:           today,
                    description:    `Lost-invoice return ${returnNumber} — ${data.reason.slice(0, 80)}`,
                    status:         "POSTED",
                    postedAt:       today,
                    refNumber:      null,
                    refVoucherId:   null,
                    paymentMode:    data.refundMode,
                    subtotal,
                    taxAmount:      taxAmt,
                    totalAmount:    total,
                    amountReceived: data.refundMode === "CASH" ? total : 0,
                    journalEntryId: je.id,
                    createdById:    user!.id,
                    lines: {
                        create: data.lines.map((l) => {
                            const p = productById.get(l.productId)!;
                            return {
                                productId:   l.productId,
                                description: `${p.sku} — ${p.name}`,
                                quantity:    l.qty,
                                rate:        l.unitPrice,
                                taxRate:     l.taxRate,
                                taxAmount:   (l.qty * l.unitPrice * l.taxRate) / 100,
                                amount:      l.qty * l.unitPrice,
                            };
                        }),
                    },
                },
                select: { id: true },
            });

            for (const l of data.lines) {
                await tx.invStockLedger.create({
                    data: {
                        productId: l.productId,
                        voucherId: rv.id,
                        branchId,
                        date:   today,
                        inQty:  l.qty,
                        outQty: 0,
                        rate:   l.unitPrice,
                        amount: l.qty * l.unitPrice,
                    },
                });
                await tx.invProductBranch.upsert({
                    where:  { productId_branchId: { productId: l.productId, branchId } },
                    create: { productId: l.productId, branchId, stock: Math.round(l.qty) },
                    update: { stock: { increment: Math.round(l.qty) } },
                });
                await tx.invProduct.update({
                    where: { id: l.productId },
                    data:  { stock: { increment: Math.round(l.qty) } },
                });
            }

            return {
                returnInvoiceId:  returnInvoice.id,
                returnNumber:     returnInvoice.number,
                journalEntryRef:  je.reference,
                returnVoucherId:  rv.id,
                returnTotal:      total,
            };
        });

        return NextResponse.json(result, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to process lost-invoice return");
    }
}
