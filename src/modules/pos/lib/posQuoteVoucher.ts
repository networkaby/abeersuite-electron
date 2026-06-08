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

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { invNextRef, calcLineTotals, calcVoucherTotals } from "@/modules/inventory/lib/stock";
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
        const voucher = await tx.invVoucher.create({
            data: {
                type,
                // Issued/final the moment it's saved — these never go through the
                // GL-post step (no GL, no stock), so leaving the default DRAFT made
                // them read as unfinished in the Day Book. POSTED here means "issued"
                // (journalEntryId stays null → no GL impact; Day Book/BS/P&L totals,
                // which are journal-entry based, are unaffected).
                status: "POSTED",
                postedAt: new Date(),
                reference,
                branchId,
                date: body.date ? new Date(body.date) : new Date(),
                description,
                accountId: body.accountId ?? null,
                partyName: body.partyName || null,
                partyType: body.partyType || null,
                partyId: body.partyId || null,
                partyPhone: body.partyPhone || null,
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
                createdById: userId,
                lines: {
                    create: computedLines.map((l) => ({
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
                },
            },
            select: { id: true, reference: true },
        });

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
        }

        return { voucherId: voucher.id, reference: voucher.reference, dealId };
    }, { timeout: 30_000, maxWait: 10_000 });
}
