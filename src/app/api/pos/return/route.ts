// POST /api/pos/return
//
// POS sale return — credit note + optional cash refund.
//
// Body: { originalInvoiceId, lines: [{ invoiceLineId, qty }], refundMode, notes? }
//   originalInvoiceId  — InvVoucher.id of the original POS/SALE (legacy field name)
//   invoiceLineId      — InvVoucherLine.id (legacy field name)
//   refundMode "CASH"     — refunds cash from the counter till (requires OPEN shift)
//   refundMode "CREDIT"   — leaves a credit balance on the customer's AR account
//   refundMode "GIFT_CARD"— puts the money back on the card the sale drew, up to
//                           what that card actually paid (audit C2). Refused when
//                           the sale used no card, or the refund exceeds the draw —
//                           a mixed-tender return still refunds by CASH or CREDIT.
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

import { prisma, prismaWhereSaved } from "@/shared/lib/prisma/prismaClient";
import { Prisma } from "@/generated/prisma/client";
import { notifyBill } from "@/shared/lib/whatsapp/notifyBill";
import { NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { buildPartyJson, readPartyName } from "@/shared/lib/accountancy/partySnapshot";
import { requirePosVoucher } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { requestBusinessDate } from "@/shared/lib/api/requestBusinessDate";
import { invNextRef, calcLineTotals } from "@/modules/inventory/lib/stock";
import { recordStockMovement } from "@/modules/inventory/lib/stockMovement";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import { buildVoucherBridgePayload } from "@/modules/accountancy/lib/voucherReceiptSample";
import { saleToSpec } from "@/modules/accountancy/lib/voucherMappers";
import { buildSettlementJson } from "@/shared/lib/accountancy/settlement";
import { systemBranchId } from "@/shared/lib/org/systemBranch";
import { enginePost, engineCreateSpine } from "@/modules/accountancy/lib/transactionEngine";
import { reverseLoyaltyForReturn, ratesFromConfig } from "@/modules/loyalty/lib";
import { reverseCouponRedemption, refundGiftCard, giftCardRefundableForSale } from "@/modules/coupons/lib";
import * as Sentry from "@sentry/nextjs";

const returnLineSchema = z.object({
    invoiceLineId: z.number().int().positive(),
    qty:           z.number().positive(),
});

const returnSchema = z.object({
    originalInvoiceId: z.number().int().positive(),
    lines:             z.array(returnLineSchema).min(1),
    refundMode:        z.enum(["CASH", "CREDIT", "GIFT_CARD"]),
    notes:             z.string().trim().max(500).optional(),
    /** Return + Print — send the thermal slip back with the answer. */
    print: z.boolean().optional(),
});

class GlPostFailedError extends Error {
    constructor(message: string, public notes: string[]) { super(message); }
}

/** The re-check inside the save found the return no longer allowed. */
class ReturnRefusedError extends Error {}

/** Quantity already returned against a sale, per product. */
async function returnedQtyByProduct(db: Prisma.TransactionClient, originalId: number): Promise<Map<number, number>> {
    const returns = await db.voucherDetail.findMany({
        where:  { refVoucherId: originalId, universalVoucher: { status: "POSTED" } },
        select: { universalVoucherId: true },
    });
    const uvIds = returns.map((r) => r.universalVoucherId).filter((id): id is number => id != null);
    const lines = uvIds.length === 0 ? [] : await db.voucherInventoryLine.findMany({
        where:  { universalVoucherId: { in: uvIds } },
        select: { productId: true, quantity: true },
    });
    const byProduct = new Map<number, number>();
    for (const l of lines) byProduct.set(l.productId, (byProduct.get(l.productId) ?? 0) + Number(l.quantity));
    return byProduct;
}

export async function POST(req: Request) {
    // The POS table's Sale Return Create tick (office Sale Return key also counts) —
    // same gate as the lost-bill return. A cash refund still needs an open shift.
    const { user, response } = await requirePosVoucher("sale-return", "create");
    if (response) return response;

    const { data, error } = await validateRequest(req, returnSchema);
    if (error) return error;

    try {
        // Checks read where the return lands: a replica may not have the last return yet.
        const db = prismaWhereSaved();
        // ── Original InvVoucher ───────────────────────────────────────────────
        const original = await db.voucherDetail.findUnique({
            where: { id: data.originalInvoiceId },
            include: {
                universalVoucher: { select: { partyAccountId: true, voucherNo: true, status: true, type: true, branchId: true, branch: { select: { id: true, gstStateCode: true } } } },   // 5D-4 party + 5D-6 ref + 5D-8 status + 5D-11 type + 5D-12 branch
            },
        });
        if (!original) return NextResponse.json({ error: "Voucher not found" }, { status: 404 });
        // 5D-4: resolve the party ledger from the spine's partyAccountId.
        const partyAccountId = original.universalVoucher?.partyAccountId ?? null;
        const account = partyAccountId != null
            ? await db.account.findUnique({ where: { id: partyAccountId }, select: { id: true, name: true, personId: true, companyId: true } })
            : null;
        // Phase 5 5C: goods lines hang off the spine.
        const originalLines = await db.voucherInventoryLine.findMany({
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

        // ── Already-returned qty per product ─────────────────────────────────
        // POS merges same-product cart lines into one line per sale, so a
        // product appears on at most one line per original voucher — matching
        // prior SALE_RETURNs back to this original by productId is unambiguous.
        const alreadyReturnedByProduct = await returnedQtyByProduct(db, original.id);

        // ── Validate return lines ─────────────────────────────────────────────
        const lineMap = new Map(originalLines.map((l) => [l.id, l]));
        const returnLines: { voucherLine: typeof originalLines[number]; qty: number }[] = [];
        for (const rl of data.lines) {
            const orig = lineMap.get(rl.invoiceLineId);
            if (!orig) return NextResponse.json({ error: `Line ${rl.invoiceLineId} not found on this voucher` }, { status: 400 });
            const alreadyReturned = alreadyReturnedByProduct.get(orig.productId) ?? 0;
            const remaining = Number(orig.quantity) - alreadyReturned;
            if (rl.qty > remaining) {
                return NextResponse.json({ error: `Return qty ${rl.qty} exceeds remaining returnable qty ${remaining} on line "${orig.description ?? orig.productId}" (${alreadyReturned} already returned)` }, { status: 400 });
            }
            returnLines.push({ voucherLine: orig, qty: rl.qty });
        }

        // ── Active shift (required for CASH refund, supplies branch context) ─
        const shift = await db.posShift.findFirst({
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
        // "" was a silent third option here; it is not a branch id, and with the
        // column NOT NULL it would fail the foreign key at save. Head Office is
        // the honest last resort — every voucher carries a real branch.
        const branchId = shift?.branchId
            ?? original.universalVoucher?.branchId
            ?? await systemBranchId(prisma);   // 5D-12: branch on spine

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

        // ── Gift-card refund context ──────────────────────────────────────────
        // Until now every return paid out cash or parked a credit, even when the
        // customer had paid with a gift card — real money left the drawer for value
        // that was never cash (audit C2). GIFT_CARD mode puts it back where it came
        // from. The cap is what the card actually paid, net of refunds already made
        // against this sale, so two partial returns cannot together give back more
        // than the card put in.
        let giftCardRefund: { giftCardId: number; code: string; refundable: number } | null = null;
        let giftCardLiabilityAccountId: number | null = null;
        if (data.refundMode === "GIFT_CARD") {
            const spineId = original.universalVoucherId;
            giftCardRefund = spineId == null ? null
                : await giftCardRefundableForSale(prisma, { saleSpineId: spineId, saleDetailId: original.id });
            if (!giftCardRefund) {
                return NextResponse.json(
                    { error: "This sale has no gift-card payment left to refund. Use Cash or Credit.", code: "GIFT_CARD_NOT_REFUNDABLE" },
                    { status: 422 },
                );
            }
            if (returnTotal > giftCardRefund.refundable + 0.005) {
                return NextResponse.json(
                    {
                        error: `Only ₹${giftCardRefund.refundable.toFixed(2)} of this sale was paid by gift card ${giftCardRefund.code}. Refund ₹${returnTotal.toFixed(2)} by Cash or Credit instead.`,
                        code:  "GIFT_CARD_REFUND_EXCEEDS_DRAW",
                    },
                    { status: 422 },
                );
            }
            const couponConfig = await prisma.couponConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
            giftCardLiabilityAccountId = couponConfig.giftCardLiabilityAccountId;
            if (giftCardLiabilityAccountId == null) {
                return NextResponse.json(
                    { error: "Gift Card Liability ledger not configured. Re-run the bootstrap seed.", code: "GIFT_CARD_LEDGER_MISSING" },
                    { status: 422 },
                );
            }
        }

        // ── Refund tender row — single Cr leg on the SALE_RETURN JE ─────
        // CASH refund  → tender.accountId = till (money leaves the drawer).
        // CREDIT note  → tender.accountId = customer AR (sits as a credit
        //                on their ledger until next sale draws it down).
        // GIFT_CARD    → tender.accountId = the Gift Card Liability ledger, the
        //                same one the original sale debited when the card was
        //                tendered — so the liability goes back up by what the
        //                card gets back, and no cash moves.
        const refundAccountId = data.refundMode === "CASH" ? tillAccountId!
                              : data.refundMode === "GIFT_CARD" ? giftCardLiabilityAccountId!
                              : partyAccountId!;

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

            // 0. One return of a bill at a time, then check again: another return (or a
            // cancel) may have landed since the checks above.
            await tx.$queryRaw`SELECT id FROM "VoucherDetail" WHERE id = ${original.id} FOR UPDATE`;
            const spineNow = await tx.universalVoucher.findUnique({ where: { id: original.universalVoucherId ?? -1 }, select: { status: true } });
            if (spineNow?.status !== "POSTED") throw new ReturnRefusedError("Only POSTED vouchers can be returned");
            const returnedNow = await returnedQtyByProduct(tx, original.id);
            const asked = new Map<number, { line: typeof originalLines[number]; qty: number }>();
            for (const rl of returnLines) {
                const { productId } = rl.voucherLine;
                asked.set(productId, { line: rl.voucherLine, qty: (asked.get(productId)?.qty ?? 0) + rl.qty });
            }
            for (const [productId, r] of asked) {
                const sold = originalLines.filter((l) => l.productId === productId).reduce((s, l) => s + Number(l.quantity), 0);
                const remaining = sold - (returnedNow.get(productId) ?? 0);
                if (r.qty > remaining) {
                    throw new ReturnRefusedError(`Return qty ${r.qty} exceeds remaining returnable qty ${remaining} on line "${r.line.description ?? productId}" — it may have just been returned`);
                }
            }

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
                    note: l.voucherLine.note,
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
            const gl = await enginePost(tx, spec, user!.id, { branchId: branchId, existingSpineId: spineId });
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

            // 2d. Gift-card refund — the Cr leg above put the liability back on the
            // books; this puts the money back on the card itself, so the two agree.
            // Recorded against THIS credit note's spine, which is what makes the
            // remaining-draw sum on a later partial return come out right.
            if (giftCardRefund) {
                await refundGiftCard(tx, {
                    giftCardId:         giftCardRefund.giftCardId,
                    amount:             returnTotal,
                    universalVoucherId: spineId,
                    createdById:        user!.id,
                });
            }

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
                returnUniversalVoucherId: gl.universalVoucherId,
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
        // Pricing-cache refresh is not part of this answer - defer it past the
        // response with after() (reliable on serverless, unlike a bare
        // fire-and-forget) so nobody waits on a cost-ledger walk.
        after(async () => {
            await recomputePricesForProducts(touchedProductIds).catch((err: unknown) => {
                Sentry.captureException(err, { tags: { source: "price-recompute", voucherId: String(result.returnVoucherId) } });
                console.error("[price-recompute] failed for voucher", result.returnVoucherId, err);
            });
        });

        // Credit note to the customer's app + WhatsApp (walk-ins are skipped inside).
        if (result.returnUniversalVoucherId != null) {
            const uvId = result.returnUniversalVoucherId;
            after(() => notifyBill("SALE_RETURN", uvId));
        }

        // The slip rides the answer, as a sale's does, so the counter prints it
        // without reading the return back from a copy it may not have reached yet.
        // The return is already saved: a slip that cannot be built never fails it.
        const returnPrint = data.print
            ? await buildVoucherBridgePayload("inv", result.returnVoucherId).catch((err: unknown) => {
                Sentry.captureException(err, { tags: { source: "pos-return-slip", voucherId: String(result.returnVoucherId) } });
                return null;
            })
            : null;

        return NextResponse.json({ ...result, returnPrint }, { status: 201 });
    } catch (e) {
        if (e instanceof ReturnRefusedError) return NextResponse.json({ error: e.message }, { status: 409 });
        if (e instanceof GlPostFailedError) {
            return NextResponse.json({ error: e.message, notes: e.notes }, { status: 500 });
        }
        return handleApiError(e, "Failed to process return");
    }
}
