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
import { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { buildPartyJson, readPartyName } from "@/shared/lib/accountancy/partySnapshot";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { invNextRef } from "@/modules/inventory/lib/stock";
import { recordStockMovement } from "@/modules/inventory/lib/stockMovement";
import { linkVoucherChildrenToSpine } from "@/modules/inventory/lib/voucherSpineLink";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import { saleToSpec } from "@/modules/accountancy/lib/voucherMappers";
import { buildSettlementJson } from "@/shared/lib/accountancy/settlement";
import { enginePost } from "@/modules/accountancy/lib/transactionEngine";
import { reverseLoyaltyForReturn, ratesFromConfig } from "@/modules/loyalty/lib";
import { reverseCouponRedemption } from "@/modules/coupons/lib";
import * as Sentry from "@sentry/nextjs";

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

        // ── Loyalty reversal context ──────────────────────────────────────────
        // Fraction of the original sale being returned (by pre-tax goods value),
        // used to claw back earned / restore redeemed points proportionally.
        const originalGoods = original.lines.reduce((s, l) => s + Number(l.quantity) * Number(l.rate), 0);
        const returnFraction = originalGoods > 0 ? returnSubtotal / originalGoods : 1;
        const loyaltyConfig = await prisma.loyaltyConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
        const loyaltyRates = ratesFromConfig(loyaltyConfig);

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
                    partyJson:      buildPartyJson({ name: original.account?.name ?? readPartyName(original.partyJson) }) ?? Prisma.DbNull,
                    partyType,
                    partyId,
                    refNumber:      original.reference,
                    refVoucherId:   original.id,
                    deliveryMode:   "COUNTER",
                    placeOfSupply:  sellerStateCode,
                    // `subtotal` is TAX-INCLUSIVE (goods + tax), matching the
                    // SALE/POS convention from calcVoucherTotals. The GL bridge
                    // derives pure goods as `subtotal − taxAmount`; passing a
                    // goods-only subtotal here makes it double-subtract the tax
                    // and the JE comes out short by exactly the GST amount.
                    subtotal:       returnSubtotal + returnTaxAmount,
                    taxAmount:      returnTaxAmount,
                    totalAmount:    returnTotal,
                    createdById:    user!.id,
                    lines: {
                        create: stockLines.map(({ voucherLine, qty }) => {
                            const rate    = Number(voucherLine.rate);
                            const taxRate = Number(voucherLine.taxRate ?? 0);
                            const goods   = qty * rate;
                            const lineTax = (goods * taxRate) / 100;
                            return {
                                productId:   voucherLine.productId!,
                                description: voucherLine.description,
                                quantity:    qty,
                                rate,
                                taxRate,
                                taxAmount:   lineTax,
                                // Tax-inclusive line amount — same convention as
                                // SALE/POS lines (stock valuation uses qty×rate
                                // directly, see recordStockMovement below).
                                amount:      goods + lineTax,
                            };
                        }),
                    },
                    // G4b: refund tender → settlementJson.
                    settlementJson: buildSettlementJson(
                        [{ accountId: refundAccountId, amount: returnTotal, method: data.refundMode === "CASH" ? "CASH" : null, reference: null }],
                        [],
                    ),
                },
                include: { lines: true },
            });

            // 2. GL post — SALE_RETURN is purchase-shape (counter Cr).
            // Tender row's accountId gets credited; body legs (Dr Sales
            // Returns / Dr GST reversal) come from goods + tax.
            const spec = await saleToSpec(tx, {
                id:          voucher.id,
                type:        voucher.type,
                reference:   voucher.reference,
                date:        voucher.date,
                description: voucher.description,
                partyJson:   voucher.partyJson,
                subtotal:    voucher.subtotal,
                taxAmount:   voucher.taxAmount,
                shippingAmt: voucher.shippingAmt,
                roundOff:    voucher.roundOff,
                totalAmount: voucher.totalAmount,
                tenders:     [{ accountId: refundAccountId, amount: returnTotal }],
                sellerStateCode,
                buyerStateCode: sellerStateCode,
            });   // GL only — stock IN handled below
            const gl = await enginePost(tx, spec, user!.id);
            if (gl.journalEntryId === null) {
                throw new GlPostFailedError(
                    `Cannot post sale return ${vRef}: engine produced no journal entry.`,
                    [],
                );
            }
            await tx.invVoucher.update({
                where: { id: voucher.id },
                data:  { journalEntryId: gl.journalEntryId, universalVoucherId: gl.universalVoucherId },
            });
            await linkVoucherChildrenToSpine(tx, voucher.id, gl.universalVoucherId);   // 5C

            // 2b. Loyalty reversal — claw back earned / restore redeemed points
            // proportional to the value returned. No-ops (returns null) when the
            // original sale had no loyalty activity (walk-in / pre-loyalty / SALE).
            const loyalty = await reverseLoyaltyForReturn(tx, {
                accountId:         original.accountId!,
                originalVoucherId: original.id,
                returnVoucherId:   voucher.id,
                returnFraction,
                rates:             loyaltyRates,
                createdById:       user!.id,
            });

            // 2c. Coupon reversal — free the usage slot on a FULL return so the
            // coupon can be used again. Non-GL (the credit note already reverses
            // goods + tax). Partial returns keep the coupon "used".
            const couponReversal = await reverseCouponRedemption(tx, {
                originalVoucherId: original.id,
                returnFraction,
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
                pointsClawedBack: loyalty?.pointsClawedBack ?? 0,
                pointsRestored:   loyalty?.pointsRestored ?? 0,
                couponsReversed:  couponReversal.reversed,
                // Back-compat aliases for the dialog
                returnInvoiceId: voucher.id,
                returnNumber:    voucher.reference,
            };
        }, {
            // Voucher + GL post + per-line stock-IN in one interactive
            // transaction; each line is ~3 sequential round-trips. A large
            // multi-line return would expire Prisma's 5s default — match the
            // POS sale / office post window. See /api/pos/sale.
            timeout: 30_000,
            maxWait: 10_000,
        });

        const touchedProductIds = returnLines
            .map((rl) => rl.voucherLine.productId)
            .filter((id): id is number => id != null);
        await recomputePricesForProducts(touchedProductIds).catch((err: unknown) => {
            Sentry.captureException(err, { tags: { source: "price-recompute", voucherId: String(result.returnVoucherId) } });
            console.error("[price-recompute] failed for voucher", result.returnVoucherId, err);
        });

        return NextResponse.json(result, { status: 201 });
    } catch (e) {
        if (e instanceof GlPostFailedError) {
            return NextResponse.json({ error: e.message, notes: e.notes }, { status: 500 });
        }
        return handleApiError(e, "Failed to process return");
    }
}
