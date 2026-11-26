// Steps of POST /api/pos/sale, moved out of the route (Part B of splitting it).
//
// Each step is the route's own code, unchanged: it takes what it reads and gives
// back what the route used to keep in local variables. A step that refuses the
// sale gives back `{ response }` — the exact reply the route used to return.
//
// Not moved (yet): coupon selection + loyalty ceiling + coupon finalize. They
// share lazily-loaded state (taxonomy, coupon input) and are tightly ordered.

import { NextResponse } from "next/server";
import type { z } from "zod";
import { prisma, prismaWhereSaved } from "@/shared/lib/prisma/prismaClient";
import { calcLineTotals } from "@/modules/inventory/lib/stock";
import { resolveEffectiveCostMap } from "@/modules/pricing-strategy/lib/resolveCost";
import { loadProtectedProductIds } from "@/modules/retention/lib/protection";
import { capToFloorExcl, floorExclFromPaise, floorRoomIncl } from "@/modules/pricing-strategy/lib/priceFloor";
import { rebatedRate } from "@/modules/pricing-strategy/lib/groupPricing";
import { payAccountMdr } from "@/modules/pos/lib/paymentGateways";
import { mdrRecovery, upliftedRates } from "@/modules/pos/lib/paymentMdr";
import { resolveProductTax } from "@/modules/inventory/lib/gstResolver";
import { lookupActiveGiftCard } from "@/modules/coupons/lib";
import { round2 } from "@/shared/lib/format";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";
import type { createSchema, lineSchema } from "./saleSchema";

export type SaleBody = z.infer<typeof createSchema>;
type SaleLine = z.infer<typeof lineSchema>;
type Refused = { response: NextResponse };

export function refused<T extends object>(r: T | Refused): r is Refused {
    return "response" in r;
}

/** Customer-facing (GST-inclusive) ₹ of a per-line pre-tax discount:
 *  Σ (line gross incl − line net incl). Used for the tier discount before and
 *  after the coupon's exclusivity zeroes some lines. */
export function lineDiscountIncl(
    lines: Pick<SaleLine, "quantity" | "unitPrice" | "taxRate">[],
    discExcl: number[],
): number {
    return lines.reduce((s, l, i) => {
        const gross = calcLineTotals({ quantity: l.quantity, rate: l.unitPrice, discountPct: 0, discountAmt: 0, taxRate: l.taxRate }).amount;
        const net = calcLineTotals({ quantity: l.quantity, rate: l.unitPrice, discountPct: 0, discountAmt: discExcl[i], taxRate: l.taxRate }).amount;
        return s + (gross - net);
    }, 0);
}

// The two settings rows a sale reads. Read where the sale saves, and created only
// when missing: Prisma runs an upsert with nothing to update as its own
// transaction of three reads — five waits on a counter saving over the internet.
export async function loadLoyaltyConfig() {
    const db = prismaWhereSaved();
    return await db.loyaltyConfig.findUnique({ where: { id: 1 } })
        ?? await db.loyaltyConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
}

export async function loadCouponConfig() {
    const db = prismaWhereSaved();
    return await db.couponConfig.findUnique({ where: { id: 1 } })
        ?? await db.couponConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
}

// ── Spend-tier discount: % of COST (incl. tax), applied per line BEFORE tax ──
// Margin is a % of cost-incl (additivePrice), so the discount is too → margin%
// and discount% at the same rate are the identical rupee amount (exact break-even).
// The server RE-RESOLVES each line's cost from the ledger (never trusts the
// client) via the product's effective cost method, then cuts each line's taxable
// by `discount% × costExcl × qty` and lets calcLineTotals recompute GST on the
// reduced base. Clamp to the line gross, and on a floored line (applyFloor) to
// the gap above its effective sale price — the safety wall (priceFloor.ts).
// No cost basis → no discount on that line. The per-line discount
// nets into line.amount, so the voucher-level discountAmt is 0 (no separate
// "Discount Allowed" leg — Sales + GST post net).
export async function priceFloorAndTier(body: SaleBody) {
    const costPaiseById = await resolveEffectiveCostMap(body.lines.map((l) => l.productId));
    const costExclById = new Map<number, number | null>(
        [...costPaiseById].map(([id, paise]) => [id, paise == null ? null : paise / 100]),
    );
    // Discount-protection blacklist (Retention → Protection) — protected lines are
    // excluded from the tier discount, coupon eligibility, and loyalty entirely.
    const protectedProductIds = await loadProtectedProductIds(prisma);
    // Safety wall: a flagged line bills from barcode and no discount may take it
    // below its effective sale price — read here, never from the client.
    // A new bill's typed price is checked on EVERY line, not just flagged ones —
    // an old counter or a hand-made request sends no applyFloor. A convert keeps
    // its source's prices (lines arrive unflagged), so it is checked flagged-only.
    const priceChecked = (l: { applyFloor?: boolean }) => !!l.applyFloor || !body.sourceVoucherId;
    const floorIds = [...new Set(body.lines.filter(priceChecked).map((l) => l.productId))];
    const floorPaiseById = new Map(floorIds.length === 0 ? [] : (await prisma.invProduct.findMany({
        where: { id: { in: floorIds } }, select: { id: true, effectiveSalePricePaise: true },
    })).map((p) => [p.id, p.effectiveSalePricePaise]));
    const lineFloorExcl = body.lines.map((l) => (l.applyFloor ? floorExclFromPaise(floorPaiseById.get(l.productId), l.taxRate) : null));
    // The wall on the typed price itself (the screen enforces it too): a line
    // under its lowest price is refused, never quietly raised.
    const underFloor = body.lines.find((l) => {
        if (!priceChecked(l)) return false;
        const f = floorExclFromPaise(floorPaiseById.get(l.productId), l.taxRate);
        return f != null && l.unitPrice < f - 0.005;
    });
    if (underFloor) {
        return {
            response: NextResponse.json(
                { error: "A line is priced below its lowest price. Refresh the bill and check the prices.", code: "BELOW_LOWEST_PRICE", productId: underFloor.productId },
                { status: 422 },
            ),
        };
    }
    // Incl ₹ the bill may drop before a floored line hits its wall; undefined = no wall on this bill.
    const floorRoom = lineFloorExcl.some((f) => f != null)
        ? floorRoomIncl(body.lines.map((l, i) => ({ qty: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate, floorExcl: lineFloorExcl[i] })))
        : undefined;
    // Per-line pre-tax discount IF the tier applies (before the coupon-drop decision).
    const lineTierDiscExclRaw = body.lines.map((l, i) => {
        const c = costExclById.get(l.productId) ?? null;
        if (c == null || body.discountPct <= 0 || protectedProductIds.has(l.productId)) return 0;
        return capToFloorExcl(Math.min((body.discountPct / 100) * c * l.quantity, l.quantity * l.unitPrice), l.quantity, l.unitPrice, lineFloorExcl[i]);
    });
    // Inclusive rupee effect (gross incl − net incl) — kept as the tier's voucher-level
    // number for the loyalty floors + coupon-stacking math (which reason about the
    // customer-facing discount), even though the discount now lives on the lines.
    const tierDiscount = lineDiscountIncl(body.lines, lineTierDiscExclRaw);
    return { costExclById, protectedProductIds, lineFloorExcl, floorRoom, lineTierDiscExclRaw, tierDiscount };
}

// ── Payment-method MDR (Settings → Payment Methods) ─────────────────────
// What the counter rang is the CASH price. A payment on a method with a bank
// charge (card; UPI above its free limit) raises the line rates toward each
// line's public tag by that charge, so the customer's "Today's discount"
// comes out smaller — never past a tag; no room left and the shop bears it.
// Worked out last, after the rebate, and by the same paymentMdr.ts helpers
// the POS screen runs on the same payments, so the total collected is the
// total posted. A UPI payment taken in parts arrives as one payment line per
// part, each under the free limit, so it costs nothing here.
// A cash-only bill, or a client that does not do MDR, never reads the methods.
export async function mdrStep(args: {
    body: SaleBody;
    payAcctById: Map<number, Parameters<typeof payAccountMdr>[0]>;
    lineRebateExcl: number[];
    protectedProductIds: Set<number>;
}) {
    const { body, payAcctById, lineRebateExcl, protectedProductIds } = args;
    const methodRows = body.mdrRecovery !== undefined && body.payments.some((p) => p.paymentAccountId != null)
        ? await prisma.paymentGateway.findMany({ select: { id: true, provider: true, configJson: true } })
        : [];
    const mdrRecoveryRs = mdrRecovery(body.payments.flatMap((p) => {
        const acct = p.paymentAccountId == null ? undefined : payAcctById.get(p.paymentAccountId);
        return acct ? [{ amount: p.amount, rule: payAccountMdr(acct, methodRows).mdr }] : [];
    }));
    if (body.mdrRecovery !== undefined && Math.abs(body.mdrRecovery - mdrRecoveryRs) > 0.005) {
        return {
            response: NextResponse.json(
                { error: "The bank-charge (MDR) settings changed since this counter loaded them. Close checkout and open it again.", code: "MDR_RULES_CHANGED" },
                { status: 409 },
            ),
        };
    }
    const lineRates = mdrRecoveryRs > 0
        ? upliftedRates(body.lines.map((l, i) => ({
            quantity: l.quantity,
            rate: rebatedRate(l.unitPrice, l.quantity, lineRebateExcl[i]),
            taxRate: l.taxRate,
            tagPaise: l.savedSalePricePaise ?? l.mrpPaise ?? null,
            fixed: protectedProductIds.has(l.productId),
        })), mdrRecoveryRs)
        : null;
    return { lineRates };
}

export type ComputedLine = {
    productId: number; description: string; note: string | null; quantity: number; freeQty: number;
    unitPrice: number; taxRate: number; discountAmt: number; discountPct: number;
    taxAmount: number; amount: number; mrpPaise: number | null; savedSalePricePaise: number | null;
};

// Free-grant lines (rule 1 on-top grant + rule 3 money-grant): the granted
// item rides the bill as a zero-price line — quantity 0 + freeQty, so stock
// and COGS move (the margin engine counts free units as real cost given
// away) but the bill math (subtotal / tax / totals) is untouched. No
// discount charge, no guard — grants are ₹-less by design.
export async function freeGrantLines(
    grantWinners: Array<{ grant: { productId: number; freeQty: number }; couponName: string }>,
) {
    const lines: ComputedLine[] = [];
    const freeLinesOut: { productId: number; freeQty: number; productName: string }[] = [];
    for (const { grant, couponName } of grantWinners) {
        const tax = await resolveProductTax(grant.productId);
        const rate = tax.taxability == null || tax.taxability === "TAXABLE" ? (tax.gstRate ?? 0) : 0;
        const freeProduct = await prisma.invProduct.findUnique({ where: { id: grant.productId }, select: { name: true } });
        lines.push({
            productId: grant.productId,
            description: `FREE · ${couponName}`,
            note: null,
            quantity: 0,
            freeQty: grant.freeQty,
            unitPrice: 0,
            taxRate: rate,
            discountAmt: 0,
            discountPct: 0,
            taxAmount: 0,
            amount: 0,
            mrpPaise: null,
            savedSalePricePaise: null,
        });
        freeLinesOut.push({ productId: grant.productId, freeQty: grant.freeQty, productName: freeProduct?.name ?? "Item" });
    }
    return { lines, freeLinesOut };
}

// ── Gift card (payment tender, NOT a discount) ─────────────────────────
// Server owns the ₹ drawn: min(balance, bill). It posts Dr "Gift Card
// Liability" via the existing tender path (postInvVoucherToGl untouched).
export async function giftCardStep(args: {
    giftCardCode: string | undefined;
    totalAmount: number;
    giftCardHold: { amount: number } | null;
}) {
    const { giftCardCode, totalAmount, giftCardHold } = args;
    let giftCardRedeem = 0;
    let giftCardId: number | null = null;
    let giftCardLiabilityAccountId: number | null = null;
    if (giftCardCode) {
        const couponConfig = await loadCouponConfig();
        giftCardLiabilityAccountId = couponConfig.giftCardLiabilityAccountId;
        const gc = await lookupActiveGiftCard(prisma, giftCardCode, new Date());
        if (!gc || gc.status !== "ACTIVE" || gc.balance <= 0 || !gc.enabled) {
            const reason = !gc ? "Gift card not found" : (!gc.enabled && gc.status === "ACTIVE") ? "Gift card is disabled" : `Gift card is ${gc.status.toLowerCase()}`;
            return { response: NextResponse.json({ error: reason, code: "GIFT_CARD_REJECTED" }, { status: 422 }) };
        }
        if (giftCardLiabilityAccountId == null) {
            return { response: NextResponse.json({ error: "Gift Card Liability ledger not configured. Re-run the bootstrap seed.", code: "GIFT_CARD_LEDGER_MISSING" }, { status: 422 }) };
        }
        if (giftCardHold && gc.balance < giftCardHold.amount - 0.005) {
            return { response: NextResponse.json({ error: `Gift card balance (₹${gc.balance}) no longer covers the ₹${giftCardHold.amount} held on this order. Edit the order before converting.`, code: "GIFT_CARD_REJECTED" }, { status: 422 }) };
        }
        giftCardRedeem = Math.min(gc.balance, totalAmount);
        giftCardId = gc.id;
    }
    return { giftCardRedeem, giftCardId, giftCardLiabilityAccountId };
}

// Repair-ticket timeline entry — records the bill, its link, and whether
// it was paid in full / partly on credit / fully on credit. Best-effort:
// a failure here never fails the (already committed) sale.
export async function logTicketBill(args: {
    ticketId: number;
    userId: number;
    totalAmount: number;
    paymentTotal: number;
    onCredit: number;
    bill: { voucherId: number; voucherRef: string };
}) {
    const { ticketId, userId, totalAmount, paymentTotal, onCredit, bill } = args;
    try {
        const billTotal = round2(totalAmount);
        const paid = round2(Math.min(paymentTotal, billTotal));
        const credit = round2(onCredit);
        const payStatus = credit <= 0.01 ? "full" : paid <= 0.01 ? "credit" : "partial";
        const payLabel =
            payStatus === "full" ? "Paid in full"
                : payStatus === "credit" ? `On credit — ₹${credit.toFixed(2)} due`
                    : `Partial — paid ₹${paid.toFixed(2)}, ₹${credit.toFixed(2)} on credit`;
        const t = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { status: true } });
        if (t) {
            const author = await buildActorSnapshot(userId);
            await prisma.ticketLog.create({
                data: {
                    ticketId: ticketId,
                    status: t.status,
                    note: `Bill ${bill.voucherRef} · ₹${billTotal.toFixed(2)} · ${payLabel}`,
                    visibility: "INTERNAL",
                    author,
                    data: {
                        bill: {
                            voucherId: bill.voucherId,
                            voucherRef: bill.voucherRef,
                            voucherType: "POS",
                            total: billTotal,
                            paid,
                            onCredit: credit,
                            status: payStatus,
                        },
                    },
                },
            });
        }
    } catch (e) {
        console.error("[pos sale] ticket timeline log failed", e);
    }
}
