// Shared creator for POS-side quotations/orders (Order-to-Cash).
//
// Both /api/pos/estimate (POS_ESTIMATE) and /api/pos/order (POS_ORDER) call this.
// These are NON-BINDING records: NO GL post, NO stock movement, NO payment
// tenders, and NO loyalty/coupon redemption (you don't burn points or consume a
// coupon on a quote). They DO carry the tier/manual bill discount (what the
// cashier negotiates with) and snapshot the tag price per line so the customer
// copy can print the tag price (discounts hidden per the org setting). When a
// party is attached they capture a CRM Deal (the "any signal → Deal" funnel).
//
// Server-only (imports the prisma singleton). Reuses the same line/total helpers
// as the office trading-voucher route so the math matches.

import { Prisma } from "@/generated/prisma/client";
import { buildPartyJson } from "@/shared/lib/accountancy/partySnapshot";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { invNextRef, calcLineTotals, calcVoucherTotals } from "@/modules/inventory/lib/stock";
import { engineCreateSpine } from "@/modules/accountancy/lib/transactionEngine";
import { syncVoucherLinks, syncVoucherLink } from "@/modules/accountancy/lib/voucherLinks";
import { getDealsPipeline, findOpenDealForParty } from "@/modules/deals/lib/dealsPipeline";
import { getOrderPipeline, orderEntryStatus } from "@/modules/order/lib/orderPipeline";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";

export type PosQuoteType = "POS_ESTIMATE" | "POS_ORDER";

export type PosQuoteLine = {
    productId: number;
    description?: string;
    quantity: number;
    /// Effective (negotiated) unit price in rupees — what the cashier quotes.
    unitPrice: number;
    taxRate?: number;
    /// MRP snapshot (paise) — struck on the customer copy.
    mrpPaise?: number;
    /// Public barcode/tag price snapshot (paise) — what the customer copy prints
    /// when discounts are hidden.
    savedSalePricePaise?: number;
};

export type PosQuoteBody = {
    accountId?: number | null;
    partyName?: string | null;
    partyType?: string | null;   // "customer" | "company"
    partyId?: number | null;     // Person.id (customer) | Company.id (company)
    partyPhone?: string | null;
    notes?: string | null;
    date?: string | null;
    /// Bill-level discount, already computed on the cashier screen. For an ORDER
    /// this is the FULL discount (tier + loyalty + coupon) so the locked total
    /// matches the POS sale it will become; for an ESTIMATE it's the tier discount.
    discountAmt?: number | null;
    discountPct?: number | null;
    /// Shipping + round-off so the saved total matches the cashier screen exactly
    /// (both flow through the same calcVoucherTotals the POS sale uses).
    shippingAmt?: number | null;
    roundOff?: number | null;
    lines: PosQuoteLine[];
};

const LABEL: Record<PosQuoteType, string> = {
    POS_ESTIMATE: "POS Estimate",
    POS_ORDER: "POS Order",
};

export async function createPosQuoteVoucher(opts: {
    type: PosQuoteType;
    branchId: string;
    userId: number;
    body: PosQuoteBody;
}): Promise<{ voucherId: number; reference: string; dealId: number | null }> {
    const { type, branchId, userId, body } = opts;
    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (lines.length === 0) throw new Error("At least one line item required");
    for (const l of lines) {
        if (!l.productId || !(l.quantity > 0)) throw new Error("Each line needs a product and quantity > 0");
    }

    const computedLines = lines.map((l) => {
        const rate = Number(l.unitPrice) || 0;
        const { discountAmt, taxAmount, amount } = calcLineTotals({
            quantity: l.quantity,
            rate,
            discountPct: 0,
            discountAmt: 0,
            taxRate: l.taxRate ?? 0,
        });
        return { ...l, rate, discountAmt, taxAmount, amount };
    });

    const lineSubtotal = computedLines.reduce((s, l) => s + l.amount, 0);
    const overallDiscount =
        body.discountAmt != null && Number(body.discountAmt) > 0
            ? Number(body.discountAmt)
            : body.discountPct != null && Number(body.discountPct) > 0
                ? (lineSubtotal * Number(body.discountPct)) / 100
                : 0;
    const shippingAmt = Number(body.shippingAmt) || 0;
    const roundOff = Number(body.roundOff) || 0;
    const { subtotal, taxAmount, totalAmount } = calcVoucherTotals(computedLines, shippingAmt, overallDiscount, roundOff, 0);

    const personId = body.partyType === "customer" && body.partyId ? body.partyId : null;
    const companyId = body.partyType === "company" && body.partyId ? body.partyId : null;
    const hasParty = personId != null || companyId != null;

    const pipeline = hasParty ? await getDealsPipeline(prisma) : null;
    if (hasParty && !pipeline) throw new Error("Deals pipeline not configured");
    const entry = pipeline?.statuses.find((s) => s.isEntryPoint) ?? pipeline?.statuses[0] ?? null;
    const actor = hasParty ? await buildActorSnapshot(userId) : null;

    // POS_ORDER rides the unified Orders pipeline (P7) so it shows on the Orders
    // board; POS_ESTIMATE does not (a quote isn't an order).
    const orderPipeline = type === "POS_ORDER" ? await getOrderPipeline(prisma) : null;
    if (type === "POS_ORDER" && !orderPipeline) throw new Error("Orders pipeline not configured");
    const orderStatusId = orderEntryStatus(orderPipeline);

    const description = `${LABEL[type]}${body.partyName ? ` — ${body.partyName}` : ""}`;
    const firstName = lines[0]?.description?.trim();

    return prisma.$transaction(async (tx) => {
        const reference = await invNextRef(tx, type, userId);
        // Phase 5 5.0c/5C: spine FIRST (the document anchor) so the goods lines hang
        // off it. These quotes are "issued" the moment they're saved (no GL, no
        // stock) → spine POSTED with no GL lines, gate-neutral.
        const spineId = await engineCreateSpine(tx, {
            type,
            date:           body.date ? new Date(body.date) : new Date(),
            description,
            friendlyRef:    reference,
            partyAccountId: body.accountId ?? null,
            userId,
        });
        await tx.universalVoucher.updateMany({
            where: { id: spineId },
            data:  { status: "POSTED", postedAt: new Date(), sourceCreatedAt: new Date() },
        });
        const voucher = await tx.invVoucher.create({
            data: {
                type,
                // POSTED here means "issued" (no GL impact — no GL lines on the spine).
                status: "POSTED",
                postedAt: new Date(),
                reference,
                branchId,
                universalVoucherId: spineId,
                date: body.date ? new Date(body.date) : new Date(),
                description,
                // 5D-4: party ledger lives on the spine (engineCreateSpine set it).
                partyJson: buildPartyJson({ name: body.partyName, phone: body.partyPhone }) ?? Prisma.DbNull,
                partyType: body.partyType || null,
                partyId: body.partyId || null,
                deliveryMode: "COUNTER",
                orderPipelineId: orderPipeline?.id ?? null,
                orderStatusId,
                discountPct: body.discountPct != null ? Number(body.discountPct) : null,
                discountAmt: overallDiscount > 0 ? overallDiscount : null,
                shippingAmt,
                roundOff,
                subtotal,
                taxAmount,
                totalAmount,
                // 5D-2: creator lives on the spine.
            },
            select: { id: true, reference: true },
        });
        // Phase 5 5C: goods lines hang off the spine.
        await tx.voucherInventoryLine.createMany({
            data: computedLines.map((l) => ({
                universalVoucherId: spineId,
                productId: l.productId,
                description: l.description || null,
                quantity: l.quantity,
                rate: l.rate,
                mrpPaise: l.mrpPaise ?? null,
                savedSalePricePaise: l.savedSalePricePaise ?? null,
                discountPct: 0,
                discountAmt: l.discountAmt,
                taxRate: l.taxRate ?? 0,
                taxAmount: l.taxAmount,
                amount: l.amount,
            })),
        });
        // Phase 5 5A: dual-write the order-pipeline link (POS_ORDER rides the board).
        await syncVoucherLinks(tx, spineId, { orderPipelineId: orderPipeline?.id ?? null, orderStatusId });

        let dealId: number | null = null;
        if (hasParty && entry && actor) {
            const open = await findOpenDealForParty(tx, { personId, companyId });
            if (open) {
                dealId = open.id;
            } else {
                const deal = await tx.deal.create({
                    data: {
                        pipelineId: pipeline!.id,
                        status: entry.id,
                        title: `${LABEL[type]} — ${body.partyName || "Customer"}${firstName ? ` (${firstName})` : ""}`,
                        contactName: body.partyName || null,
                        phone: body.partyPhone || null,
                        personId,
                        companyId,
                        valuePaise: Math.round(totalAmount * 100),
                        source: LABEL[type],
                        createdBy: actor as Prisma.InputJsonValue,
                    },
                    select: { id: true },
                });
                dealId = deal.id;
            }
            await tx.dealActivity.create({
                data: {
                    dealId,
                    author: actor as Prisma.InputJsonValue,
                    kind: "SYSTEM",
                    body: `${LABEL[type]} ${reference} created (₹${totalAmount.toFixed(2)})${body.notes ? ` — ${body.notes}` : ""}`,
                },
            });
            await tx.invVoucher.update({ where: { id: voucher.id }, data: { dealId } });
            await syncVoucherLink(tx, spineId, "DEAL", dealId);   // Phase 5 5A dual-write
        }

        return { voucherId: voucher.id, reference: voucher.reference, dealId };
    }, { timeout: 30_000, maxWait: 10_000 });
}
