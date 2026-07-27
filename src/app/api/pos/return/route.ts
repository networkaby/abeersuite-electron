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
import { requestBusinessDate } from "@/shared/lib/api/requestBusinessDate";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { invNextRef, calcLineTotals } from "@/modules/inventory/lib/stock";
import { recordStockMovement } from "@/modules/inventory/lib/stockMovement";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import { saleToSpec } from "@/modules/accountancy/lib/voucherMappers";
import { buildSettlementJson } from "@/shared/lib/accountancy/settlement";
import { enginePost, engineCreateSpine } from "@/modules/accountancy/lib/transactionEngine";
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
        const original = await prisma.voucherDetail.findUnique({
            where: { id: data.originalInvoiceId },
            include: {
                universalVoucher: { select: { partyAccountId: true, voucherNo: true, status: true, type: true, branchId: true, branch: { select: { id: true, gstStateCode: true } } } },   // 5D-4 party + 5D-6 ref + 5D-8 status + 5D-11 type + 5D-12 branch
            },
        });
        if (!original) return NextResponse.json({ error: "Voucher not found" }, { status: 404 });
        // 5D-4: resolve the party ledger from the spine's partyAccountId.
        const partyAccountId = original.universalVoucher?.partyAccountId ?? null;
        const account = partyAccountId != null
            ? await prisma.account.findUnique({ where: { id: partyAccountId }, select: { id: true, name: true, personId: true, companyId: true } })
            : null;
        // Phase 5 5C: goods lines hang off the spine.
        const originalLines = await prisma.voucherInventoryLine.findMany({
            where: { universalVoucherId: original.universalVoucherId ?? -1 },
        });
        if (original.universalVoucher?.status !== "POSTED") {
            return NextResponse.json({ error: "Only POSTED vouchers can be returned" }, { status: 409 });
        }
        if (original.universalVoucher?.type !== "POS" && original.universalVoucher?.type !== "SALE") {
            return NextResponse.json({ error: `Cannot return a ${original.universalVoucher?.type} voucher — only POS/SALE` }, { status: 409 });
        }
        if (!partyAccountId) {
            return NextResponse.json({ error: "Voucher has no customer account linked" }, { status: 400 });
        }

        // ── Validate return lines ─────────────────────────────────────────────
        const lineMap = new Map(originalLines.map((l) => [l.id, l]));
        const returnLines: { voucherLine: typeof originalLines[number]; qty: number }[] = [];
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
        const branchId = shift?.branchId ?? original.universalVoucher?.branchId ?? "";   // 5D-12: branch on spine

        // ── Compute return totals ─────────────────────────────────────────────
        // Prorate the ORIGINAL line's spend-tier discount by the fraction of that line
        // being returned, so the credit note reverses the NET amount the customer paid
        // (not the gross tag) and GST reverses on the reduced taxable at each line's
        // own rate. A line with no discount reverses at gross exactly as before.
        const returnComputed = returnLines.map(({ voucherLine, qty }) => {
            const rate    = Number(voucherLine.rate);
            const taxRate = Number(voucherLine.taxRate ?? 0);
            const origQty  = Number(voucherLine.quantity) || 0;
            const origDisc = Number(voucherLine.discountAmt ?? 0);
            const lineDisc = origQty > 0 ? (origDisc * qty) / origQty : 0;
            const { discountAmt, taxAmount, amount } = calcLineTotals({ quantity: qty, rate, discountPct: 0, discountAmt: lineDisc, taxRate });
            return {
                voucherLine, qty, rate, taxRate,
                discountAmt,
                discountPct: Number(voucherLine.discountPct ?? 0),
                taxAmount, amount,
                goodsNet: qty * rate - discountAmt,   // pre-tax net goods
                goodsGross: qty * rate,               // pre-tax gross — for the loyalty fraction
            };
        });
        const returnGoodsNet  = returnComputed.reduce((s, l) => s + l.goodsNet, 0);
        const returnTaxAmount = returnComputed.reduce((s, l) => s + l.taxAmount, 0);
        // Prorated pre-tax tier discount being reversed — stored as the voucher-level
        // discountAmt (with a GROSS subtotal) so the engine emits the Discount
        // Allowed reversal leg (Cr on a sale return), mirroring the original JE.
        const returnDiscount  = returnComputed.reduce((s, l) => s + l.discountAmt, 0);
        const returnTotal     = returnGoodsNet + returnTaxAmount;
        if (returnTotal <= 0) return NextResponse.json({ error: "Return total must be > 0" }, { status: 400 });

        // ── Refund tender row — single Cr leg on the SALE_RETURN JE ─────
        // CASH refund → tender.accountId = till (money leaves the drawer).
        // CREDIT note → tender.accountId = customer AR (sits as a credit
        //               on their ledger until next sale draws it down).
        const refundAccountId = data.refundMode === "CASH" ? tillAccountId! : partyAccountId!;

        // ── Mirror partyType/partyId for legacy GL resolver fallbacks ────
        const partyType = account?.personId !== null && account?.personId !== undefined ? "customer"
                         : account?.companyId !== null && account?.companyId !== undefined ? "company"
                         : "account";
        const partyId = account?.personId
                       ?? account?.companyId
                       ?? partyAccountId;

        const sellerStateCode = (original.universalVoucher?.branch?.gstStateCode || "").trim() || null;   // 5D-12: branch on spine

        // ── Loyalty reversal context ──────────────────────────────────────────
        // Fraction of the original sale being returned (by pre-tax goods value),
        // used to claw back earned / restore redeemed points proportionally.
        const originalGoods = originalLines.reduce((s, l) => s + Number(l.quantity) * Number(l.rate), 0);
        const returnGrossGoods = returnComputed.reduce((s, l) => s + l.goodsGross, 0);
        const returnFraction = originalGoods > 0 ? returnGrossGoods / originalGoods : 1;
        const loyaltyConfig = await prisma.loyaltyConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
        const loyaltyRates = ratesFromConfig(loyaltyConfig);

        // ── Transaction ───────────────────────────────────────────────────────
        const result = await prisma.$transaction(async (tx) => {
            const today = requestBusinessDate(req);

            // 1. SALE_RETURN InvVoucher + refund tender row.
            const vRef = await invNextRef(tx, "SALE_RETURN");
            const stockLines = returnComputed.filter((rl) => rl.voucherLine.productId !== null);
            // Phase 5 5.0/5C: spine FIRST; enginePost attaches GL via existingSpineId.
            const voucherDescription = `Sale return of ${original.universalVoucher?.voucherNo ?? ""}${data.notes ? ` — ${data.notes}` : ""}`;
            const spineId = await engineCreateSpine(tx, {
                type:           "SALE_RETURN",
                date:           today,
                description:    voucherDescription,
                voucherNo:    vRef,
                partyAccountId: partyAccountId,
                branchId,   // 5D-12: branch primary on the spine
                userId:         user!.id,
            });
            const voucher = await tx.voucherDetail.create({
                data: {
                    // 5D-11/5D-12: type + branch live on the spine (engineCreateSpine set them).
                    universalVoucherId: spineId,
                    // 5D-5/5D-8/5D-10: description + postedAt + status + date + 5D-4 party live on the spine.
                    partyJson:      buildPartyJson({ name: account?.name ?? readPartyName(original.partyJson) }) ?? Prisma.DbNull,
                    partyType,
                    partyId,
                    refNumber:      original.universalVoucher?.voucherNo ?? null,
                    refVoucherId:   original.id,
                    deliveryMode:   "COUNTER",
                    placeOfSupply:  sellerStateCode,
                    // GROSS of the reversed tier discount — subtotal − taxAmount must
                    // equal the gross goods so the body (Sales Returns) leg reverses
                    // the full gross, with the discount reversal on its own leg.
                    subtotal:       returnGoodsNet + returnTaxAmount + returnDiscount,
                    taxAmount:      returnTaxAmount,
                    discountAmt:    returnDiscount,
                    totalAmount:    returnTotal,
                    // 5D-2: creator lives on the spine.
                    // G4b: refund tender → settlementJson.
                    settlementJson: buildSettlementJson(
                        [{ accountId: refundAccountId, amount: returnTotal, method: data.refundMode === "CASH" ? "CASH" : null, reference: null }],
                        [],
                    ),
                },
            });
            // Phase 5 5C: goods lines hang off the spine.
            await tx.voucherInventoryLine.createMany({
                data: stockLines.map((l) => ({
                    universalVoucherId: spineId,
                    productId:   l.voucherLine.productId!,
                    description: l.voucherLine.description,
                    quantity:    l.qty,
                    rate:        l.rate,
                    taxRate:     l.taxRate,
                    // Prorated tier discount reversed with the line, so the credit note
                    // mirrors the net Sales + net GST the original sale posted.
                    discountAmt: l.discountAmt,
                    discountPct: l.discountPct,
                    taxAmount:   l.taxAmount,
                    amount:      l.amount,
                })),
            });

            // 2. GL post — SALE_RETURN is purchase-shape (counter Cr).
            // Tender row's accountId gets credited; body legs (Dr Sales
            // Returns / Dr GST reversal) come from goods + tax.
            const spec = await saleToSpec(tx, {
                id:          voucher.id,
                type:        "SALE_RETURN",   // 5D-11: type on the spine
                reference:   vRef,
                date:        today,   // 5D-10: date on the spine (attach-mode ignores spec.date)
                description: voucherDescription,
                partyJson:   voucher.partyJson,
                subtotal:    voucher.subtotal,
                taxAmount:   voucher.taxAmount,
                shippingAmt: voucher.shippingAmt,
                discountAmt: voucher.discountAmt,
                roundOff:    voucher.roundOff,
                totalAmount: voucher.totalAmount,
                tenders:     [{ accountId: refundAccountId, amount: returnTotal }],
                sellerStateCode,
                buyerStateCode: sellerStateCode,
            });   // GL only — stock IN handled below
            const gl = await enginePost(tx, spec, user!.id, { existingSpineId: spineId });
            if (gl.journalEntryId === null) {
                throw new GlPostFailedError(
                    `Cannot post sale return ${vRef}: engine produced no journal entry.`,
                    [],
                );
            }
            await tx.voucherDetail.update({
                where: { id: voucher.id },
                data:  { universalVoucherId: gl.universalVoucherId },
            });

            // 2b. Loyalty reversal — claw back earned / restore redeemed points
            // proportional to the value returned. No-ops (returns null) when the
            // original sale had no loyalty activity (walk-in / pre-loyalty / SALE).
            const loyalty = await reverseLoyaltyForReturn(tx, {
                accountId:                  partyAccountId!,
                originalUniversalVoucherId: original.universalVoucherId,
                originalVoucherId:          original.id,
                returnUniversalVoucherId:   spineId,
                returnVoucherId:            voucher.id,
                returnFraction,
                rates:                      loyaltyRates,
                createdById:                user!.id,
            });

            // 2c. Coupon reversal — free the usage slot on a FULL return so the
            // coupon can be used again. Non-GL (the credit note already reverses
            // goods + tax). Partial returns keep the coupon "used".
            const couponReversal = await reverseCouponRedemption(tx, {
                originalUniversalVoucherId: original.universalVoucherId,
                returnFraction,
            });

            // 3. Stock IN for each returned product.
            for (const { voucherLine, qty } of stockLines) {
                const productId = voucherLine.productId!;
                const rate      = Number(voucherLine.rate);
                await recordStockMovement(tx, {
                    universalVoucherId: spineId,
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
                returnVoucherRef: vRef,
                journalEntryId:  gl.journalEntryId,
                returnTotal,
                pointsClawedBack: loyalty?.pointsClawedBack ?? 0,
                pointsRestored:   loyalty?.pointsRestored ?? 0,
                couponsReversed:  couponReversal.reversed,
                // Back-compat aliases for the dialog
                returnInvoiceId: voucher.id,
                returnNumber:    vRef,
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
