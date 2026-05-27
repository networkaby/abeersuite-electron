// POST /api/pos/return
//
// POS sale return — credit note + optional cash refund.
//
// Body: { originalInvoiceId, lines: [{ invoiceLineId, qty }], refundMode, notes? }
//   originalInvoiceId  — InvVoucher.id of the original POS/SALE (legacy field name)
//   invoiceLineId      — InvVoucherLine.id (legacy field name)
//   refundMode "CASH"  — refunds cash from the counter till (requires OPEN shift)
//   refundMode "CREDIT"— leaves a credit balance on the customer's AR account
//
// Steps (one $transaction):
//   1. Validate qtys against the original InvVoucher's lines (cap per line).
//   2. Create a SALE_RETURN InvVoucher pointing to the original via
//      `refVoucherId`, lines mirrored with positive qtys (stock-direction
//      flips on post).
//   3. Post via `postInvVoucherToGl` — SALE_RETURN with paymentMode=CASH
//      posts (Dr Sales Returns / Dr GST Output reversal / Cr Till); with
//      paymentMode=CREDIT it posts (… / Cr Customer AR), parking the refund
//      as a credit on the customer's ledger.
//   4. Stock IN: per-product InvStockLedger + branch/global counter.
//
// Replaces the legacy three-table flow (Invoice negative credit-note +
// manual JE + parallel InvVoucher) — see Layer 2c of the plan.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { invNextRef } from "@/modules/inventory/lib/stock";
import { recordStockMovement } from "@/modules/inventory/lib/stockMovement";
import { postInvVoucherToGl } from "@/modules/accountancy/lib/postInvVoucher";

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

class GlPostFailedError extends Error {
    constructor(message: string, public notes: string[]) { super(message); }
}

export async function POST(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.POS_SHIFT_OPEN);
    if (response) return response;

    const { data, error } = await validateRequest(req, returnSchema);
    if (error) return error;

    try {
        // ── Original InvVoucher ───────────────────────────────────────────────
        const original = await prisma.invVoucher.findUnique({
            where: { id: data.originalInvoiceId },
            include: {
                lines: true,
                account: { select: { id: true, name: true, personId: true, companyId: true } },
                branch:  { select: { id: true, gstStateCode: true } },
            },
        });
        if (!original) return NextResponse.json({ error: "Voucher not found" }, { status: 404 });
        if (original.status !== "POSTED") {
            return NextResponse.json({ error: "Only POSTED vouchers can be returned" }, { status: 409 });
        }
        if (original.type !== "POS" && original.type !== "SALE") {
            return NextResponse.json({ error: `Cannot return a ${original.type} voucher — only POS/SALE` }, { status: 409 });
        }
        if (!original.accountId) {
            return NextResponse.json({ error: "Voucher has no customer account linked" }, { status: 400 });
        }

        // ── Validate return lines ─────────────────────────────────────────────
        const lineMap = new Map(original.lines.map((l) => [l.id, l]));
        const returnLines: { voucherLine: typeof original.lines[number]; qty: number }[] = [];
        for (const rl of data.lines) {
            const orig = lineMap.get(rl.invoiceLineId);
            if (!orig) return NextResponse.json({ error: `Line ${rl.invoiceLineId} not found on this voucher` }, { status: 400 });
            if (rl.qty > Number(orig.quantity)) {
                return NextResponse.json({ error: `Return qty ${rl.qty} exceeds original qty ${orig.quantity} on line "${orig.description ?? orig.productId}"` }, { status: 400 });
            }
            returnLines.push({ voucherLine: orig, qty: rl.qty });
        }

        // ── Active shift (required for CASH refund, supplies branch context) ─
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
        // Branch context — prefer the shift, fall back to the original voucher's branch
        // (manager could be processing a return from a different branch than the original sale).
        const branchId = shift?.branchId ?? original.branchId;

        // ── Compute return totals ─────────────────────────────────────────────
        const returnSubtotal = returnLines.reduce((s, { voucherLine, qty }) => {
            return s + qty * Number(voucherLine.rate);
        }, 0);
        const returnTaxAmount = returnLines.reduce((s, { voucherLine, qty }) => {
            const tax = Number(voucherLine.taxRate ?? 0);
            return s + (qty * Number(voucherLine.rate) * tax) / 100;
        }, 0);
        const returnTotal = returnSubtotal + returnTaxAmount;
        if (returnTotal <= 0) return NextResponse.json({ error: "Return total must be > 0" }, { status: 400 });

        // ── Refund tender row — single Cr leg on the SALE_RETURN JE ─────
        // CASH refund → tender.accountId = till (money leaves the drawer).
        // CREDIT note → tender.accountId = customer AR (sits as a credit
        //               on their ledger until next sale draws it down).
        const refundAccountId = data.refundMode === "CASH" ? tillAccountId! : original.accountId!;

        // ── Mirror partyType/partyId for legacy GL resolver fallbacks ────
        const partyType = original.account?.personId !== null && original.account?.personId !== undefined ? "customer"
                         : original.account?.companyId !== null && original.account?.companyId !== undefined ? "company"
                         : "account";
        const partyId = original.account?.personId
                       ?? original.account?.companyId
                       ?? original.accountId;

        const sellerStateCode = (original.branch.gstStateCode || "").trim() || null;

        // ── Transaction ───────────────────────────────────────────────────────
        const result = await prisma.$transaction(async (tx) => {
            const today = new Date();

            // 1. SALE_RETURN InvVoucher + refund tender row.
            const vRef = await invNextRef(tx, "SALE_RETURN");
            const stockLines = returnLines.filter((rl) => rl.voucherLine.productId !== null);
            const voucher = await tx.invVoucher.create({
                data: {
                    type:           "SALE_RETURN",
                    reference:      vRef,
                    branchId,
                    date:           today,
                    description:    `Sale return of ${original.reference}${data.notes ? ` — ${data.notes}` : ""}`,
                    status:         "POSTED",
                    postedAt:       today,
                    accountId:      original.accountId,
                    partyName:      original.account?.name ?? original.partyName,
                    partyType,
                    partyId,
                    refNumber:      original.reference,
                    refVoucherId:   original.id,
                    deliveryMode:   "COUNTER",
                    placeOfSupply:  sellerStateCode,
                    subtotal:       returnSubtotal,
                    taxAmount:      returnTaxAmount,
                    totalAmount:    returnTotal,
                    createdById:    user!.id,
                    lines: {
                        create: stockLines.map(({ voucherLine, qty }) => ({
                            productId:   voucherLine.productId!,
                            description: voucherLine.description,
                            quantity:    qty,
                            rate:        Number(voucherLine.rate),
                            taxRate:     Number(voucherLine.taxRate ?? 0),
                            taxAmount:   (qty * Number(voucherLine.rate) * Number(voucherLine.taxRate ?? 0)) / 100,
                            amount:      qty * Number(voucherLine.rate),
                        })),
                    },
                    tenders: {
                        create: [{
                            accountId: refundAccountId,
                            amount:    returnTotal,
                            method:    data.refundMode === "CASH" ? "CASH" : null,
                            reference: null,
                        }],
                    },
                },
                include: { lines: true, tenders: { include: { account: { select: { id: true, name: true, normalBalance: true, group: { select: { type: true } } } } } } },
            });

            // 2. GL post — SALE_RETURN is purchase-shape (counter Cr).
            // Tender row's accountId gets credited; body legs (Dr Sales
            // Returns / Dr GST reversal) come from goods + tax.
            const gl = await postInvVoucherToGl(tx, {
                voucherId: voucher.id,
                voucher: {
                    id:          voucher.id,
                    type:        voucher.type,
                    reference:   voucher.reference,
                    date:        voucher.date,
                    description: voucher.description,
                    partyName:   voucher.partyName,
                    partyType:   voucher.partyType,
                    partyId:     voucher.partyId,
                    subtotal:    voucher.subtotal,
                    taxAmount:   voucher.taxAmount,
                    shippingAmt: voucher.shippingAmt,
                    roundOff:    voucher.roundOff,
                    totalAmount: voucher.totalAmount,
                    tenders:     voucher.tenders.map((t) => ({
                        accountId: t.accountId,
                        amount:    Number(t.amount),
                        account:   t.account,
                    })),
                    sellerStateCode,
                    buyerStateCode: sellerStateCode,
                },
                userId: user!.id,
            });
            if (gl.journalEntryId === null) {
                throw new GlPostFailedError(
                    `Cannot post sale return ${vRef}: GL bridge could not build a journal entry.`,
                    gl.notes,
                );
            }
            await tx.invVoucher.update({
                where: { id: voucher.id },
                data:  { journalEntryId: gl.journalEntryId },
            });

            // 3. Stock IN for each returned product.
            for (const { voucherLine, qty } of stockLines) {
                const productId = voucherLine.productId!;
                const rate      = Number(voucherLine.rate);
                await recordStockMovement(tx, {
                    voucherId: voucher.id,
                    productId,
                    branchId,
                    date:   today,
                    inQty:  qty,
                    outQty: 0,
                    rate,
                    amount: qty * rate,
                });
            }

            return {
                returnVoucherId: voucher.id,
                returnVoucherRef: voucher.reference,
                journalEntryId:  gl.journalEntryId,
                returnTotal,
                // Back-compat aliases for the dialog
                returnInvoiceId: voucher.id,
                returnNumber:    voucher.reference,
            };
        });

        return NextResponse.json(result, { status: 201 });
    } catch (e) {
        if (e instanceof GlPostFailedError) {
            return NextResponse.json({ error: e.message, notes: e.notes }, { status: 500 });
        }
        return handleApiError(e, "Failed to process return");
    }
}
