import { NextResponse, type NextRequest } from "next/server";
import { systemBranchId } from "@/shared/lib/org/systemBranch";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { buildPartyJson, readPartyName } from "@/shared/lib/accountancy/partySnapshot";
import { buildSettlementJson } from "@/shared/lib/accountancy/settlement";
import { invNextRef, calcLineTotals } from "@/modules/inventory/lib/stock";
import { recordStockMovement } from "@/modules/inventory/lib/stockMovement";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import { saleToSpec } from "@/modules/accountancy/lib/voucherMappers";
import { enginePost, engineCreateSpine } from "@/modules/accountancy/lib/transactionEngine";
import { reverseLoyaltyForReturn, ratesFromConfig } from "@/modules/loyalty/lib";
import { reverseCouponRedemption } from "@/modules/coupons/lib";
import { createSystemInboxNotifications } from "@/modules/message/lib/inbox";
import { spawnShopRefund } from "@/modules/refund/lib/refund";
import { ORDER_STAGE } from "@/modules/order/lib/orderPipeline";
import { round2 } from "@/shared/lib/format";
import { requestBusinessDate } from "@/shared/lib/api/requestBusinessDate";

// POST /api/ecommerce/orders/[id]/return — one-click FULL return of a shop
// order, in either of the two real-world cases (they differ in who caused the
// return and what we refund):
//
//   mode "RTO"      — delivery FAILED and the parcel came back to us (courier
//                     charged forward + RTO freight). The customer never got the
//                     goods → refund the FULL paid amount INCLUDING shipping.
//                     The credit note also reverses the shipping income.
//   mode "CUSTOMER" — delivered, then the customer returned it (reverse
//                     pickup / posted back). Refund the GOODS amount only —
//                     shipping stays earned (standard practice).
//
// What one click does (mirroring /api/pos/return, engine-direct):
//   1. SALE_RETURN voucher against the linked posted ONLINE_INVOICE
//      (refVoucherId), ALL lines reversed — prorated tier discount fully
//      reversed, GST reversed per line, RTO also reverses shipping + its GST.
//   2. Refund tender = customer AR (a credit on their ledger) — the actual
//      pay-back is the P9 refund's payout voucher (Dr customer / Cr the
//      gateway settlement ledger the money arrived in), keeping AR at zero.
//   3. Stock IN + loyalty claw-back/restore + coupon usage-slot freed (full
//      return) — the same shared reversal helpers the counter uses.
//   4. Order ticket → Returned (S49); PAID orders spawn a P9 refund with the
//      case's amount, linked to the order's auto-posted advance receipt.
//
// Idempotent: an existing non-cancelled SALE_RETURN against the invoice is
// returned as-is (and the refund spawn is one-per-order).

const bodySchema = z.object({ mode: z.enum(["RTO", "CUSTOMER"]) });

class GlPostFailedError extends Error {}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireModuleAccess("e-commerce");
    if (response) return response;
    const { id } = await ctx.params;
    const oid = parseInt(id, 10);
    if (!Number.isFinite(oid)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const { data, error } = await validateRequest(req, bodySchema);
    if (error) return error;

    try {
        // ── The order + its linked posted ONLINE_INVOICE ─────────────────────
        const t = await prisma.ticket.findUnique({
            where: { id: oid },
            select: {
                id: true,
                status: true,
                accountId: true,
                account: { select: { name: true, personId: true, companyId: true } },
                order: {
                    select: {
                        paymentMethod: true,
                        paidAt: true,
                        legacyStatus: true,
                        totalPaise: true,
                        shippingChargePaise: true,
                        shippingAddress: true,
                    },
                },
            },
        });
        if (!t?.order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

        const links = await prisma.voucherLink.findMany({
            where: { kind: "SHOP_ORDER", targetId: String(oid) },
            select: { universalVoucherId: true },
        });
        const invSpine = links.length
            ? await prisma.universalVoucher.findFirst({
                  where: { id: { in: links.map((l) => l.universalVoucherId) }, status: "POSTED" },
                  orderBy: { id: "desc" },
                  select: {
                      id: true,
                      voucherNo: true,
                      partyAccountId: true,
                      branchId: true,
                      branch: { select: { gstStateCode: true } },
                      voucherDetail: { select: { id: true, partyJson: true, shippingAmt: true, shippingTaxAmt: true } },
                  },
              })
            : null;
        if (!invSpine?.voucherDetail) {
            return NextResponse.json(
                { error: "No posted invoice is linked to this order — nothing to reverse." },
                { status: 422 },
            );
        }
        const invDetail = invSpine.voucherDetail;
        const partyAccountId = invSpine.partyAccountId ?? t.accountId;
        if (!partyAccountId) {
            return NextResponse.json({ error: "The invoice has no customer account linked." }, { status: 400 });
        }

        // Idempotent: one live return per invoice.
        const priorReturn = await prisma.voucherDetail.findFirst({
            where: {
                refVoucherId: invDetail.id,
                universalVoucher: { type: "SALE_RETURN", status: { not: "CANCELLED" } },
            },
            select: { id: true, universalVoucher: { select: { voucherNo: true } } },
        });
        if (priorReturn) {
            return NextResponse.json({
                already: true,
                returnVoucherId: priorReturn.id,
                reference: priorReturn.universalVoucher?.voucherNo ?? null,
            });
        }

        const originalLines = await prisma.voucherInventoryLine.findMany({
            where: { universalVoucherId: invSpine.id },
        });
        if (originalLines.length === 0) {
            return NextResponse.json({ error: "The invoice has no goods lines to reverse." }, { status: 422 });
        }

        // ── Full-return math (POS-return parity, fraction = 1) ───────────────
        const returnComputed = originalLines.map((l) => {
            const qty = Number(l.quantity);
            const rate = Number(l.rate);
            const taxRate = Number(l.taxRate ?? 0);
            const lineDisc = Number(l.discountAmt ?? 0); // full line discount reversed
            const { discountAmt, taxAmount, amount } = calcLineTotals({
                quantity: qty, rate, discountPct: 0, discountAmt: lineDisc, taxRate,
            });
            return {
                line: l, qty, rate, taxRate, discountAmt, taxAmount, amount,
                discountPct: Number(l.discountPct ?? 0),
                goodsNet: qty * rate - discountAmt,
            };
        });
        const returnGoodsNet = returnComputed.reduce((s, l) => s + l.goodsNet, 0);
        const returnTax = returnComputed.reduce((s, l) => s + l.taxAmount, 0);
        const returnDiscount = returnComputed.reduce((s, l) => s + l.discountAmt, 0);

        // RTO reverses shipping income + its GST too (customer never received);
        // a customer return keeps shipping earned.
        const shipping = data.mode === "RTO" ? Number(invSpine.voucherDetail.shippingAmt ?? 0) : 0;
        const shippingTax = data.mode === "RTO" ? Number(invSpine.voucherDetail.shippingTaxAmt ?? 0) : 0;
        const returnTotal = round2(returnGoodsNet + returnTax + shipping);
        if (returnTotal <= 0) return NextResponse.json({ error: "Return total must be > 0" }, { status: 422 });

        const partyType = t.account?.personId != null ? "customer" : t.account?.companyId != null ? "company" : "account";
        const partyId = t.account?.personId ?? t.account?.companyId ?? partyAccountId;
        const sellerStateCode = (invSpine.branch?.gstStateCode || "").trim() || null;
        const branchId = invSpine.branchId ?? await systemBranchId(prisma);

        const loyaltyConfig = await prisma.loyaltyConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
        const loyaltyRates = ratesFromConfig(loyaltyConfig);

        const modeLabel = data.mode === "RTO" ? "delivery failed (RTO received back)" : "customer return";

        const result = await prisma.$transaction(async (tx) => {
            // 1. SALE_RETURN spine + detail + lines.
            const vRef = await invNextRef(tx, "SALE_RETURN");
            const description = `Online return — Order #${oid} (${modeLabel}) against ${invSpine.voucherNo ?? ""}`;
            const spineId = await engineCreateSpine(tx, {
                type: "SALE_RETURN",
                date: requestBusinessDate(req),
                description,
                voucherNo: vRef,
                partyAccountId,
                branchId,
                userId: user!.id,
            });
            const voucher = await tx.voucherDetail.create({
                data: {
                    universalVoucherId: spineId,
                    partyJson:
                        buildPartyJson({ name: t.account?.name ?? readPartyName(invDetail.partyJson) ?? "Customer" }) ??
                        Prisma.DbNull,
                    partyType,
                    partyId,
                    refNumber: invSpine.voucherNo ?? null,
                    refVoucherId: invDetail.id,
                    deliveryMode: "SHIPPED",
                    placeOfSupply: sellerStateCode,
                    // GROSS of the reversed tier discount (POS-return shape); the
                    // RTO case also reverses shipping + its GST on their own legs.
                    subtotal: round2(returnGoodsNet + returnTax + returnDiscount),
                    taxAmount: returnTax,
                    discountAmt: returnDiscount,
                    shippingAmt: shipping || undefined,
                    shippingTaxAmt: shipping ? shippingTax : undefined,
                    totalAmount: returnTotal,
                    // Refund tender = customer AR (credit on their ledger); the P9
                    // payout voucher pays the money back and zeroes it.
                    settlementJson: buildSettlementJson(
                        [{ accountId: partyAccountId, amount: returnTotal, method: null, reference: null }],
                        [],
                    ),
                },
            });
            await tx.voucherInventoryLine.createMany({
                data: returnComputed.map((l) => ({
                    universalVoucherId: spineId,
                    productId: l.line.productId,
                    description: l.line.description,
                    note: l.line.note,
                    quantity: l.qty,
                    rate: l.rate,
                    taxRate: l.taxRate,
                    discountAmt: l.discountAmt,
                    discountPct: l.discountPct,
                    taxAmount: l.taxAmount,
                    amount: l.amount,
                })),
            });

            // 2. GL post (Dr Sales Returns / Dr GST reversal [/ Dr Shipping
            //    Income on RTO] / Cr Customer AR).
            const spec = await saleToSpec(tx, {
                id: voucher.id,
                type: "SALE_RETURN",
                reference: vRef,
                date: requestBusinessDate(req),
                description,
                partyJson: voucher.partyJson,
                subtotal: voucher.subtotal,
                taxAmount: voucher.taxAmount,
                shippingAmt: voucher.shippingAmt,
                shippingTaxAmt: shipping ? shippingTax : undefined,
                discountAmt: voucher.discountAmt,
                roundOff: voucher.roundOff,
                totalAmount: voucher.totalAmount,
                tenders: [{ accountId: partyAccountId, amount: returnTotal }],
                sellerStateCode,
                buyerStateCode: sellerStateCode,
            });
            const gl = await enginePost(tx, spec, user!.id, { branchId: branchId, existingSpineId: spineId });
            if (gl.journalEntryId === null) {
                throw new GlPostFailedError(`Cannot post return ${vRef}: engine produced no journal entry.`);
            }

            // 3. Loyalty claw-back/restore + coupon slot freed (full return).
            await reverseLoyaltyForReturn(tx, {
                accountId: partyAccountId,
                originalUniversalVoucherId: invSpine.id,
                originalVoucherId: invSpine.voucherDetail!.id,
                returnUniversalVoucherId: spineId,
                returnVoucherId: voucher.id,
                returnFraction: 1,
                rates: loyaltyRates,
                createdById: user!.id,
            });
            await reverseCouponRedemption(tx, {
                originalUniversalVoucherId: invSpine.id,
                returnFraction: 1,
            });

            // 4. Stock IN per line.
            for (const l of returnComputed) {
                if (l.line.productId == null) continue;
                await recordStockMovement(tx, {
                    universalVoucherId: spineId,
                    productId: l.line.productId,
                    branchId,
                    date: requestBusinessDate(req),
                    inQty: l.qty,
                    outQty: 0,
                    rate: l.rate,
                    amount: l.qty * l.rate,
                });
            }

            // 5. Order → Returned (direct move — the return IS the sanctioned
            //    path; the pipeline graph has no Delivered→Returned edge).
            await tx.ticket.update({ where: { id: oid }, data: { status: ORDER_STAGE.RETURNED } });

            return { returnVoucherId: voucher.id, reference: vRef };
        }, { timeout: 30_000, maxWait: 10_000 });

        // ── P9 refund for PAID orders (post-commit; spawn is idempotent) ─────
        const o = t.order;
        const isPaid = o.legacyStatus === "PAID" || !!o.paidAt;
        let refundTicketId: number | null = null;
        let refundPaise = 0;
        if (isPaid) {
            // RTO → full paid amount incl. shipping; customer return → goods only.
            refundPaise =
                data.mode === "RTO"
                    ? (o.totalPaise ?? 0) + (o.shippingChargePaise ?? 0)
                    : Math.round(returnTotal * 100);
            const addr = (o.shippingAddress ?? {}) as { receiptVoucherId?: unknown };
            // Already the advance receipt's SPINE id — onlineReceipt.ts stamps what
            // engineCreateVoucher returned, and spawnShopRefund wants exactly that
            // (getRefundForPayout reads it back off UniversalVoucher). A RECEIPT has no
            // VoucherDetail row, so there is nothing to resolve through.
            const receiptSpineId = Number(addr.receiptVoucherId) || null;
            const spawned = await spawnShopRefund({
                orderId: oid,
                amountPaise: refundPaise,
                sourceSpineId: receiptSpineId,
                reason: data.mode === "RTO" ? "Delivery failed — RTO received back" : "Customer return",
            });
            refundTicketId = spawned?.refundTicketId ?? null;
        }

        await createSystemInboxNotifications({
            roleIds: ["R1", "R2"],
            actorUserId: user!.id,
            title: `Order #${oid} — return posted (${data.mode === "RTO" ? "RTO" : "customer return"})`,
            body:
                `Credit note ${result.reference} posted, stock back in.` +
                (refundTicketId ? ` Refund of ₹${(refundPaise / 100).toFixed(2)} queued on the Refund board.` : ""),
            link: `/office/ecommerce/orders/${oid}`,
        }).catch(() => undefined);

        await recomputePricesForProducts(
            originalLines.map((l) => l.productId).filter((x): x is number => x != null),
        ).catch(() => undefined);

        return NextResponse.json({ ...result, refundTicketId, refundPaise });
    } catch (e) {
        if (e instanceof GlPostFailedError) {
            return NextResponse.json({ error: e.message }, { status: 422 });
        }
        return handleApiError(e, "Failed to process the return");
    }
}
