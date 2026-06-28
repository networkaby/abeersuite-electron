import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse, after } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { invNextRef, calcVoucherTotals } from "@/modules/inventory/lib/stock";
import { recordStockMovementsBatch } from "@/modules/inventory/lib/stockMovement";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import { saleToSpec } from "@/modules/accountancy/lib/voucherMappers";
import { buildSettlementJson } from "@/shared/lib/accountancy/settlement";
import { enginePost, engineCreateSpine } from "@/modules/accountancy/lib/transactionEngine";
import { postReceiptVoucher } from "@/modules/accountancy/lib/postReceiptVoucher";
import { channelToPaymentMethod } from "@/modules/pos/lib/counterTenders";
import { Prisma, type PaymentMethod } from "@/generated/prisma/client";
import { buildPartyJson } from "@/shared/lib/accountancy/partySnapshot";
import { getOpenSaleBillsForFifo } from "@/modules/accountancy/lib/outstandings";
import { getVoucherTemplate } from "@/shared/lib/print/voucherTemplate";
import * as Sentry from "@sentry/nextjs";
import { validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { checkCreditLimit, CreditLimitError } from "@/shared/lib/accountancy/checkCreditLimit";
import {
    ratesFromConfig,
    buildRulesIndex,
    redeemableBaseForCart,
    clampRedemption,
    applyLoyaltyForSale,
    applyMilestones,
    liveBalance,
    type EarnLine,
    type TaxonomyMaps,
    type MilestoneTier,
} from "@/modules/loyalty/lib";
import {
    selectCouponForCart,
    finalizeCouponAmount,
    recordCouponRedemption,
    lookupActiveGiftCard,
    redeemGiftCard,
    type CartLineLite,
    type EvalInput,
} from "@/modules/coupons/lib";
// Note: branch context comes from the cashier's active shift, NOT from the
// session cookie. This allows multiple browsers / users to bill in parallel
// from different counters without their active-branch cookie interfering.

// POST /api/pos/sale
//
// Atomic POS sale — single InvVoucher (type=POS) carrying items, multi-
// tender settlement rows (Cash / UPI / Card / etc.), stock movement, and
// GST routing. One balanced JE per voucher; no separate Receipt voucher
// or VoucherAllocation. Same shape as office SALE post-Layer 7.
//
// Posting flow (one $transaction):
//   1. Resolve customer Account, branch state, validate tender total.
//   2. Create InvVoucher + lines + tender rows in a single nested write.
//   3. postInvVoucherToGl → one JE: Dr per tender (Till / Bank / AR) /
//      Cr Sales / Cr CGST+SGST or IGST. Wire JE id back onto voucher.
//   4. InvStockLedger + per-branch + org-wide stock decrement per line.
//
// Replaces the prior three-step write (Invoice + InvoiceLine + Payment),
// later the receipt-voucher detour, with the unified tender shape.
//
// As of 2026-05-14 the route requires the cashier to have an OPEN PosShift
// in the active branch. The CASH portion of any payment auto-debits the
// shift's tillAccountId; non-CASH portions debit the user-picked bank account.
// See docs/modules/pos.md.

const lineSchema = z.object({
    productId:   z.number().int().positive(),
    description: z.string().trim().min(1),
    quantity:    z.number().positive(),
    unitPrice:   z.number().min(0),
    taxRate:     z.number().min(0).max(100).default(0),
    // Snapshots for the customer-facing "Today's discount" price ladder (paise).
    mrpPaise:            z.number().int().nonnegative().nullish(),
    savedSalePricePaise: z.number().int().nonnegative().nullish(),
});

const paymentSchema = z.object({
    // Which counter payment account collected this — null = CASH (the till).
    // The server resolves its ledger + method from the counter's list.
    paymentAccountId: z.number().int().positive().nullable(),
    amount:           z.number().positive(),
    reference:        z.string().trim().max(120).optional(),
});

// Signed amount — positive raises the bill (Cr Income leg), negative lowers it
// (Dr Expense leg). Mirrors office SALE charges. accountId is the GL account
// the leg posts against.
const chargeSchema = z.object({
    accountId:   z.number().int().positive(),
    description: z.string().trim().max(200).optional(),
    amount:      z.number().refine((n) => Math.abs(n) >= 0.005, "Charge amount must be non-zero"),
});

const createSchema = z.object({
    accountId: z.number().int().positive(),                                       // customer AR account
    issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dueDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    notes:     z.string().trim().optional(),
    lines:     z.array(lineSchema).min(1, "At least one line item required"),
    payments:  z.array(paymentSchema).min(1, "At least one payment line required"),
    shippingAmt: z.number().min(0).default(0),
    roundOff:    z.number().default(0),  // signed
    charges:     z.array(chargeSchema).default([]),
    // Voucher-level tier discount (₹). Reduces the bill via the existing
    // discountAmt → "Discount Allowed" path. Client-supplied (cashier-trusted,
    // same as line prices). Server still validates payment total == bill total.
    discountAmt: z.number().min(0).default(0),
    // Spend-tier % that produced discountAmt (e.g. 5 for Gold). Stored so the
    // receipt can label the "Level Discount (Gold)" row by resolving the tier
    // name from this %. 0 when no tier applied.
    discountPct: z.number().min(0).max(100).default(0),
    // Loyalty points the customer wants to burn. The server is authoritative for
    // the ₹ value (recomputed from LoyaltyConfig) and validates against balance.
    redeemPoints: z.number().int().min(0).default(0),
    // Coupon code the cashier entered (server resolves the ₹ value + validity).
    couponCode: z.string().trim().max(40).optional(),
    // When true (and no code), the server auto-applies the best eligible offer.
    autoApply: z.boolean().default(false),
    // Gift-card code to redeem as a payment tender (server owns the ₹ drawn).
    giftCardCode: z.string().trim().max(40).optional(),
    // Collect-on-the-go: when true, the cashier is knowingly accepting MORE than
    // the bill. The surplus settles the customer's oldest open bills (FIFO) and
    // any leftover becomes a customer advance — booked as a separate Receipt
    // voucher so the bank/UPI statement matches 1:1. Requires an identified
    // customer; rejected alongside a gift-card redemption.
    collectSurplus: z.boolean().default(false),
});

class GlPostFailedError extends Error {
    constructor(message: string, public notes: string[]) { super(message); }
}

export async function POST(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { data, error } = await validateRequest(req, createSchema);
    if (error) return error;
    const body = data;
    const _t0 = performance.now(); // perf timing — see [pos-timing] log before the response

    // ── Active shift requirement ──────────────────────────────────────────
    // Branch context comes from the shift, not the session cookie.
    // This lets multiple users bill in parallel from different browsers
    // without their active-branch cookie interfering.
    // Independent reads — fetch in parallel (separate pooled connections) instead
    // of three serial round-trips. Guards run after, in the same order + messages.
    const [shift, customerAccount, loyaltyConfig] = await Promise.all([
        prisma.posShift.findFirst({
            where:  { userId: user!.id, status: "OPEN" },
            select: {
                id: true, branchId: true,
                counter: {
                    select: {
                        name: true,
                        tillAccountId: true,
                        paymentAccounts: {
                            where:  { isActive: true },
                            select: { id: true, channel: true, accountId: true, label: true },
                        },
                    },
                },
            },
        }),
        prisma.account.findUnique({
            where:  { id: body.accountId },
            select: {
                id: true, name: true, personId: true, companyId: true,
                person:  { select: { name: true } },
                company: { select: { name: true } },
            },
        }),
        prisma.loyaltyConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} }),
    ]);
    if (!shift) {
        return NextResponse.json(
            { error: "Open a shift before billing.", code: "NO_OPEN_SHIFT" },
            { status: 400 },
        );
    }
    const tillAccountId  = shift.counter.tillAccountId;
    const activeBranchId = shift.branchId;
    // The counter's payment accounts (id → {channel, ledger}). A non-cash payment
    // line carries the chosen paymentAccountId; we resolve its ledger + method
    // here. Operator configures these under /office/admin/counters.
    const payAcctById = new Map(shift.counter.paymentAccounts.map((a) => [a.id, a]));
    const counterName = shift.counter.name;

    // ── Resolve customer account (party ledger) ───────────────────────────
    // The new schema stores `accountId` directly on InvVoucher. We also
    // capture the display name + identity ids for the partyName/partyType/
    // partyId triple so postInvVoucherToGl can build the JE description and
    // any legacy reader (until Layer 5) still sees the old fields populated.
    if (!customerAccount) {
        return NextResponse.json({ error: "Customer account not found." }, { status: 422 });
    }
    const partyName = customerAccount.person?.name
                   ?? customerAccount.company?.name
                   ?? customerAccount.name;
    const partyType = customerAccount.personId !== null ? "customer"
                     : customerAccount.companyId !== null ? "company"
                     : "account";
    const partyId   = customerAccount.personId
                   ?? customerAccount.companyId
                   ?? customerAccount.id;

    // ── Loyalty context ───────────────────────────────────────────────────
    // Only identified customers (a real Person/Company account) earn or redeem;
    // anonymous walk-in / counter ledgers never accrue points.
    const isIdentified = customerAccount.personId !== null || customerAccount.companyId !== null;
    const loyaltyRates = ratesFromConfig(loyaltyConfig);
    const loyaltyEnabled = isIdentified && loyaltyRates.enabled;
    // Live, dynamic balance — Σ in-window lots (respects the current expiry window).
    const loyaltyBalance = loyaltyEnabled
        ? await liveBalance(prisma, customerAccount.id, loyaltyRates)
        : 0;
    // Enabled milestone tiers (only loaded when loyalty is live for this customer).
    // Empty → the milestone award step is skipped entirely below.
    const milestoneTiers: MilestoneTier[] = loyaltyEnabled
        ? (await prisma.loyaltyMilestone.findMany({ where: { enabled: true }, orderBy: { threshold: "asc" } }))
            .map((m) => ({ id: m.id, threshold: Number(m.threshold), bonusPoints: m.bonusPoints, label: m.label, issuesCouponTemplateId: m.issuesCouponTemplateId }))
        : [];

    // ── Validate line items + payment totals ──────────────────────────────
    const computedLines = body.lines.map((l) => {
        const lineSubtotal = l.quantity * l.unitPrice;
        const lineTax = (lineSubtotal * l.taxRate) / 100;
        return {
            productId:   l.productId,
            description: l.description,
            quantity:    l.quantity,
            unitPrice:   l.unitPrice,
            taxRate:     l.taxRate,
            taxAmount:   lineTax,
            amount:      lineSubtotal + lineTax,
            // Customer-facing ladder snapshots (paise) — display only.
            mrpPaise:            l.mrpPaise ?? null,
            savedSalePricePaise: l.savedSalePricePaise ?? null,
        };
    });
    // Shipping / round-off / charges parity with office SALE — same single
    // source of truth (calcVoucherTotals) so /api/inventory/vouchers and
    // /api/pos/sale always agree on the math.
    const taxAmount = computedLines.reduce((s, l) => s + l.taxAmount, 0);

    // ── Discounts: tier (Discount Allowed) + loyalty redemption (Loyalty Points
    // Redeemed) ───────────────────────────────────────────────────────────────
    // goodsValue = pre-tax goods (Σ qty × unit price). The tier discount rides the
    // voucher-level discountAmt path; the loyalty redemption rides a negative
    // charge to the dedicated ledger so the two are broken out in the P&L.
    const goodsValue = body.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    const tierDiscount = Math.min(Math.max(0, body.discountAmt), goodsValue);

    // Pre-redemption invoice value — drives the min-invoice-to-earn and
    // min-invoice-to-redeem floors (the bill the customer would pay before any
    // loyalty redemption is applied).
    const manualChargesNet = body.charges.reduce((s, c) => s + c.amount, 0);
    const invoiceValueGross = goodsValue + taxAmount + body.shippingAmt - tierDiscount + body.roundOff + manualChargesNet;

    // ── Pre-load loyalty earn context (reads, outside the tx) ──────────────
    // Resolves each line's taxonomy + the earn-rule index (earn multiplier AND
    // redeem-cap %) + group/category parent chains so both the per-line
    // multiplier and the cart-aware redeem ceiling (product → group → category →
    // global) can be computed. Skipped for walk-in / disabled — no extra queries.
    let earnLines: EarnLine[] = [];
    let rulesIndex = buildRulesIndex([]);
    let taxonomyMaps: TaxonomyMaps = { groupParent: new Map(), categoryParent: new Map() };
    if (loyaltyEnabled) {
        const productIds = [...new Set(body.lines.map((l) => l.productId))];
        const [products, groups, categories, rules] = await Promise.all([
            prisma.invProduct.findMany({ where: { id: { in: productIds } }, select: { id: true, groupId: true, categoryId: true } }),
            prisma.invProductGroup.findMany({ select: { id: true, parentId: true } }),
            prisma.invCategory.findMany({ select: { id: true, parentId: true } }),
            prisma.loyaltyEarnRule.findMany({ where: { enabled: true }, select: { scope: true, categoryId: true, groupId: true, productId: true, multiplier: true, redeemCapPct: true, enabled: true } }),
        ]);
        const taxById = new Map(products.map((p) => [p.id, p]));
        earnLines = body.lines.map((l) => {
            const p = taxById.get(l.productId);
            return { productId: l.productId, groupId: p?.groupId ?? null, categoryId: p?.categoryId ?? null, goods: l.quantity * l.unitPrice };
        });
        rulesIndex = buildRulesIndex(rules.map((r) => ({ ...r, multiplier: Number(r.multiplier), redeemCapPct: r.redeemCapPct == null ? null : Number(r.redeemCapPct) })));
        taxonomyMaps = {
            groupParent: new Map(groups.map((g) => [g.id, g.parentId])),
            categoryParent: new Map(categories.map((c) => [c.id, c.parentId])),
        };
    }

    // Server owns the redemption ₹ value — never trust the client. The ceiling is
    // cart-aware: Σ (line net × that item's redeem cap %), folding in the global
    // cap as the per-line default. Clamp against balance, that ceiling, and floors.
    const requestedRedeem = loyaltyEnabled ? body.redeemPoints : 0;
    const redeemCeiling = loyaltyEnabled
        ? redeemableBaseForCart(earnLines, tierDiscount, rulesIndex, taxonomyMaps, loyaltyRates.maxRedeemPctOfBill)
        : 0;
    const redemption = clampRedemption(requestedRedeem, loyaltyBalance, redeemCeiling, invoiceValueGross, loyaltyRates);
    if (requestedRedeem > 0 && redemption.points === 0 && redemption.reason) {
        return NextResponse.json({ error: redemption.reason, code: "LOYALTY_REDEEM_REJECTED" }, { status: 422 });
    }
    const redeemPoints     = redemption.points;
    const redemptionRupees = redemption.value;
    if (redemptionRupees > 0 && loyaltyConfig.redeemExpenseAccountId == null) {
        return NextResponse.json(
            { error: "Loyalty redemption ledger is not configured. Re-run the bootstrap seed.", code: "LOYALTY_LEDGER_MISSING" },
            { status: 422 },
        );
    }

    // ── Coupon / promotion ─────────────────────────────────────────────────
    // The server resolves the code (or best AUTO offer) and OWNS the ₹ value. A
    // coupon discount rides the SAME negative-charge path as loyalty redemption,
    // to a dedicated "Coupon Discounts" ledger (postInvVoucherToGl untouched).
    // Stacking: a non-stackable coupon is the ONLY discount — it drops the spend-
    // tier discount and blocks loyalty redemption (reject so the cashier sees why).
    let couponRupees = 0;
    let couponId: number | null = null;
    let couponExpenseAccountId: number | null = null;
    let effectiveTierDiscount = tierDiscount;
    if (body.couponCode || body.autoApply) {
        const couponConfig = await prisma.couponConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
        couponExpenseAccountId = couponConfig.couponExpenseAccountId;
        // First-time buyer = no prior POSTED SALE/POS voucher (identified only).
        const isNewCustomer = isIdentified
            ? (await prisma.invVoucher.count({ where: { universalVoucher: { partyAccountId: customerAccount.id, status: "POSTED", deletedAt: null, type: { in: ["SALE", "POS"] } } } })) === 0
            : false;
        // Coupon eligibility needs each line's taxonomy (include/exclude rules).
        // Reuse the loyalty earn lines when present; else load just for the coupon.
        let couponLines: CartLineLite[];
        if (earnLines.length) {
            couponLines = earnLines.map((e) => ({ productId: e.productId, groupId: e.groupId, categoryId: e.categoryId, qty: 1, unitPrice: e.goods }));
        } else {
            const productIds = [...new Set(body.lines.map((l) => l.productId))];
            const products = await prisma.invProduct.findMany({ where: { id: { in: productIds } }, select: { id: true, groupId: true, categoryId: true } });
            const taxById = new Map(products.map((p) => [p.id, p]));
            couponLines = body.lines.map((l) => ({ productId: l.productId, groupId: taxById.get(l.productId)?.groupId ?? null, categoryId: taxById.get(l.productId)?.categoryId ?? null, qty: l.quantity, unitPrice: l.unitPrice }));
        }
        const couponInput: EvalInput = {
            accountId: isIdentified ? customerAccount.id : null,
            lines: couponLines,
            goodsValue,
            billBeforeCoupon: goodsValue,
            isNewCustomer,
            now: new Date(),
        };
        const selected = await selectCouponForCart(prisma, { code: body.couponCode, autoApply: body.autoApply, channel: "POS", input: couponInput });
        if (selected.kind === "error") {
            return NextResponse.json({ error: selected.reason, code: "COUPON_REJECTED" }, { status: 422 });
        }
        if (selected.kind === "ok") {
            if (!selected.coupon.stackable && redeemPoints > 0) {
                return NextResponse.json(
                    { error: "This coupon can't be combined with loyalty points. Remove the points to use it.", code: "COUPON_BLOCKS_LOYALTY" },
                    { status: 422 },
                );
            }
            const fin = finalizeCouponAmount({
                selectedDiscount:    selected.discountRupees,
                tierRupees:          tierDiscount,
                loyaltyRupees:       redemptionRupees,
                goodsValue,
                couponStackable:     selected.coupon.stackable,
                maxTotalDiscountPct: couponConfig.maxTotalDiscountPct != null ? Number(couponConfig.maxTotalDiscountPct) : null,
            });
            couponRupees = fin.couponRupees;
            couponId = selected.coupon.id;
            effectiveTierDiscount = fin.effTier; // 0 when the coupon isn't stackable
            if (couponRupees > 0 && couponExpenseAccountId == null) {
                return NextResponse.json(
                    { error: "Coupon ledger is not configured. Re-run the bootstrap seed.", code: "COUPON_LEDGER_MISSING" },
                    { status: 422 },
                );
            }
        }
    }
    const couponCharge = couponRupees > 0 && couponExpenseAccountId != null
        ? { accountId: couponExpenseAccountId, description: `Coupon: ${body.couponCode ?? "auto"}`, amount: -couponRupees }
        : null;

    // Loyalty redemption as a negative charge row on the dedicated ledger. Posts
    // Dr "Loyalty Points Redeemed" via postInvVoucherToGl's charge handling and
    // lowers the bill via chargesNet — no change to the protected GL math.
    const loyaltyCharge = redemptionRupees > 0 && loyaltyConfig.redeemExpenseAccountId != null
        ? { accountId: loyaltyConfig.redeemExpenseAccountId, description: `Loyalty: ${redeemPoints} pts redeemed`, amount: -redemptionRupees }
        : null;
    const allCharges = [
        ...body.charges,
        ...(loyaltyCharge ? [loyaltyCharge] : []),
        ...(couponCharge ? [couponCharge] : []),
    ];

    const chargesNet = allCharges.reduce((s, c) => s + c.amount, 0);
    const { subtotal, totalAmount } = calcVoucherTotals(
        computedLines,
        body.shippingAmt,
        effectiveTierDiscount,   // tier discount (0 when a non-stackable coupon replaces it)
        body.roundOff,
        chargesNet,              // includes the negative loyalty + coupon charges
    );

    // ── Gift card (payment tender, NOT a discount) ─────────────────────────
    // Server owns the ₹ drawn: min(balance, bill). It posts Dr "Gift Card
    // Liability" via the existing tender path (postInvVoucherToGl untouched).
    let giftCardRedeem = 0;
    let giftCardId: number | null = null;
    let giftCardLiabilityAccountId: number | null = null;
    if (body.giftCardCode) {
        const couponConfig = await prisma.couponConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
        giftCardLiabilityAccountId = couponConfig.giftCardLiabilityAccountId;
        const gc = await lookupActiveGiftCard(prisma, body.giftCardCode, new Date());
        if (!gc || gc.status !== "ACTIVE" || gc.balance <= 0 || !gc.enabled) {
            const reason = !gc ? "Gift card not found" : (!gc.enabled && gc.status === "ACTIVE") ? "Gift card is disabled" : `Gift card is ${gc.status.toLowerCase()}`;
            return NextResponse.json({ error: reason, code: "GIFT_CARD_REJECTED" }, { status: 422 });
        }
        if (giftCardLiabilityAccountId == null) {
            return NextResponse.json({ error: "Gift Card Liability ledger not configured. Re-run the bootstrap seed.", code: "GIFT_CARD_LEDGER_MISSING" }, { status: 422 });
        }
        giftCardRedeem = Math.min(gc.balance, totalAmount);
        giftCardId = gc.id;
    }

    // Cash/UPI/etc. payments + the gift-card tender vs the bill. Three arms:
    //   • exact (|surplus| ≤ 1p) → today's exact-pay sale, unchanged.
    //   • under (surplus < 0)    → rejected; an on-credit sale goes through /sale.
    //   • over  (surplus > 0)    → allowed ONLY with collectSurplus: the extra
    //     settles the customer's oldest open bills (FIFO) + leftover advance, via
    //     a separate Receipt voucher (so the bank/UPI statement matches 1:1).
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const paymentTotal = body.payments.reduce((s, p) => s + p.amount, 0) + giftCardRedeem;
    const surplus = round2(paymentTotal - totalAmount);
    const collectingSurplus = surplus > 0.01;
    if (surplus < -0.01) {
        return NextResponse.json(
            { error: `Payment total (₹${paymentTotal.toFixed(2)}) is less than invoice total (₹${totalAmount.toFixed(2)}). Use /sale for a credit sale.` },
            { status: 422 },
        );
    }
    if (collectingSurplus) {
        if (!body.collectSurplus) {
            return NextResponse.json(
                { error: `Payment total (₹${paymentTotal.toFixed(2)}) exceeds invoice total (₹${totalAmount.toFixed(2)}). Set collectSurplus to take the extra as advance / collect old dues, or return the change.`, code: "SURPLUS_NOT_CONFIRMED" },
                { status: 422 },
            );
        }
        if (!isIdentified) {
            return NextResponse.json(
                { error: "Overpayment can only be kept against an identified customer. Attach a customer, or return the cash.", code: "SURPLUS_NEEDS_CUSTOMER" },
                { status: 422 },
            );
        }
        if (giftCardRedeem > 0.005) {
            return NextResponse.json(
                { error: "Can't combine a gift-card redemption with an overpayment. Settle the bill on the gift card alone, or drop the gift card.", code: "SURPLUS_WITH_GIFTCARD" },
                { status: 422 },
            );
        }
    }

    // Resolve each payment line to its settlement ledger + method via the
    // counter's payment-account list. CASH (paymentAccountId null) → till. A
    // non-cash line must reference one of THIS counter's accounts (rejected
    // otherwise — the checkout only offers the counter's accounts, so this is a
    // guardrail). The ledger is written onto the tender, so the same UPI account
    // always lands on the same bank regardless of cashier.
    const METHOD_LABEL: Record<PaymentMethod, string> = {
        CASH: "Cash", MOBILE_PAYMENT: "UPI", CARD: "Card", CHEQUE: "Cheque", BANK_TRANSFER: "Bank Transfer", OTHER: "Wallet",
    };
    const resolvedPayments: { method: PaymentMethod; accountId: number; amount: number; reference?: string }[] = [];
    for (const p of body.payments) {
        if (p.paymentAccountId == null) {
            resolvedPayments.push({ method: "CASH", accountId: tillAccountId, amount: p.amount, reference: p.reference });
            continue;
        }
        const acct = payAcctById.get(p.paymentAccountId);
        if (!acct) {
            return NextResponse.json(
                { error: `Counter "${counterName}" doesn't have that payment account. Reconfigure under /office/admin/counters.`, code: "PAYMENT_METHOD_NOT_MAPPED" },
                { status: 422 },
            );
        }
        resolvedPayments.push({ method: channelToPaymentMethod(acct.channel), accountId: acct.accountId, amount: p.amount, reference: p.reference });
    }

    // Amount that will increase the customer's AR balance (onCredit portion).
    // Currently the route enforces paymentTotal === totalAmount so this is
    // always 0 — the check is a forward-compatibility guard for partial payments.
    // Round to paise: the inclusive-price + roundOff float math can leave a
    // sub-paise residue (e.g. totalAmount = 960.0000000000004 vs a ₹960 payment).
    // That crumb is not a real credit balance, but left unrounded it slips past
    // the ±0.01 payment-match guard yet still trips checkCreditLimit's
    // `additionalDebit > 0` test — wrongly rejecting a fully-paid sale to a
    // zero-credit-limit customer with NO_CREDIT_ALLOWED. Matches the >0.005
    // epsilon the AR-tender branch below already uses.
    const onCredit = Math.max(0, Math.round((totalAmount - paymentTotal) * 100) / 100);

    // POS is always counter-pickup → place of supply = branch state regardless
    // of customer's address (CGST Act §10(1)(c)). Resolve once, outside tx.
    const posBranch = await prisma.branch.findUnique({
        where: { id: activeBranchId },
        select: { gstStateCode: true },
    });
    const sellerStateCode = (posBranch?.gstStateCode || "").trim() || null;

    try {
        const _tPreTx = performance.now();
        const result = await prisma.$transaction(async (tx) => {
            // ── Credit limit check (inside tx so balance read is fresh) ────
            await checkCreditLimit(tx, body.accountId, onCredit);

            // ── 1. InvVoucher (type=POS) + lines + tender rows ───────────
            // Single voucher carries the entire sale: items, tender rows
            // (Cash / UPI / Card — one per resolved payment, plus an AR
            // tender for any unsettled balance). postInvVoucherToGl posts
            // a single balanced JE per voucher; no separate Receipt
            // voucher / VoucherAllocation needed.
            const voucherRef = await invNextRef(tx, "POS");
            // POS today enforces paymentTotal == totalAmount, so onCredit
            // is always 0 and no AR tender is needed. Kept as a future-
            // facing branch in case partial POS sales get enabled.
            const arRemainder = totalAmount - paymentTotal;
            // Under surplus the sale is settled FROM the customer ledger: a single
            // AR tender for the exact bill (Dr Customer / Cr Sales+GST). The actual
            // money — cash/UPI/card — rides the Receipt voucher below at its real
            // ledger, so the bank/UPI statement still matches one voucher 1:1.
            const tenderPayload = collectingSurplus
                ? [{ accountId: customerAccount.id, amount: totalAmount, method: null as null, reference: null as null }]
                : [
                    ...resolvedPayments.map((p) => ({
                        accountId: p.accountId,
                        amount:    p.amount,
                        method:    p.method,
                        reference: p.reference ?? null,
                    })),
                    // Gift-card tender — Dr "Gift Card Liability" (bypasses counterMethodMap;
                    // its ledger is the liability, not the counter wallet).
                    ...(giftCardRedeem > 0.005 && giftCardLiabilityAccountId != null
                        ? [{ accountId: giftCardLiabilityAccountId, amount: giftCardRedeem, method: "OTHER" as const, reference: `Gift card ${body.giftCardCode}` }]
                        : []),
                    // AR leg for the unpaid portion (on-credit). POS enforces exact pay,
                    // so this is 0 today — kept as a forward-facing branch for partials.
                    ...(arRemainder > 0.005
                        ? [{ accountId: customerAccount.id, amount: arRemainder, method: null as null, reference: null as null }]
                        : []),
                ];
            // Phase 5 5.0/5C: spine FIRST (the document anchor) so goods lines hang
            // off it; enginePost attaches the GL lines + flips it via existingSpineId.
            const voucherDescription = body.notes?.trim() || `POS sale — ${partyName}`;
            const spineId = await engineCreateSpine(tx, {
                type:           "POS",
                date:           new Date(body.issueDate),
                description:    voucherDescription,
                voucherNo:    voucherRef,
                partyAccountId: customerAccount.id,
                branchId:       activeBranchId,   // 5D-12: branch primary on the spine
                userId:         user!.id,
            });
            const voucher = await tx.invVoucher.create({
                data: {
                    // 5D-11/5D-12: type + branch live on the spine (engineCreateSpine set them).
                    universalVoucherId: spineId,
                    // 5D-5/5D-8/5D-10: description + postedAt + status + date + 5D-4 party live on the spine.
                    partyJson:      buildPartyJson({ name: partyName }) ?? Prisma.DbNull,
                    partyType,
                    partyId,
                    deliveryMode:   "COUNTER",
                    placeOfSupply:  sellerStateCode,
                    shippingAmt:    body.shippingAmt,
                    discountAmt:    effectiveTierDiscount,
                    // Store the tier % only when the tier discount actually applied
                    // (a non-stackable coupon can drop it → effectiveTierDiscount 0).
                    discountPct:    effectiveTierDiscount > 0 ? body.discountPct : 0,
                    roundOff:       body.roundOff,
                    subtotal,
                    taxAmount,
                    totalAmount,
                    // 5D-2: creator lives on the spine (engineCreateSpine set it).
                    // G4b: tender + charge INPUT → settlementJson (the spine's
                    // role=TENDER/CHARGE GL lines are emitted from it on POST).
                    settlementJson: buildSettlementJson(tenderPayload, allCharges),
                },
            });
            // Phase 5 5C: goods lines hang off the spine.
            await tx.voucherInventoryLine.createMany({
                data: computedLines.map((l) => ({
                    universalVoucherId: spineId,
                    productId:   l.productId,
                    description: l.description,
                    quantity:    l.quantity,
                    rate:        l.unitPrice,
                    taxRate:     l.taxRate,
                    taxAmount:   l.taxAmount,
                    amount:      l.amount,
                    mrpPaise:            l.mrpPaise,
                    savedSalePricePaise: l.savedSalePricePaise,
                })),
            });

            // ── 2. GL post (Dr Till/Bank + (optional) Dr Customer AR / Cr Sales / Cr GST) ─
            // postInvVoucherToGl reads the tender rows directly — one Dr
            // leg per tender. No back-compat single-paymentAccount path.
            // GL via the Transaction Engine (GL only — POS moves stock itself
            // via recordStockMovementsBatch). saleToSpec reads the tender rows
            // directly — one Dr leg per tender. POS is counter-pickup → intra-state.
            const spec = await saleToSpec(tx, {
                id:          voucher.id,
                type:        "POS",   // 5D-11: type on the spine
                reference:   voucherRef,
                date:        new Date(body.issueDate),   // 5D-10: date on the spine (attach-mode ignores spec.date)
                description: voucherDescription,
                partyJson:   voucher.partyJson,
                subtotal:    voucher.subtotal,
                taxAmount:   voucher.taxAmount,
                shippingAmt: voucher.shippingAmt,
                discountAmt: voucher.discountAmt,
                roundOff:    voucher.roundOff,
                totalAmount: voucher.totalAmount,
                // Tenders/charges straight from the in-memory input (no DB round-trip).
                tenders:     tenderPayload.map((t) => ({ accountId: t.accountId, amount: Number(t.amount), method: t.method, reference: t.reference })),
                charges:     allCharges.map((c) => ({ accountId: c.accountId, amount: Number(c.amount), description: c.description })),
                sellerStateCode,
                buyerStateCode: sellerStateCode, // counter pickup → intra-state
            });
            const gl = await enginePost(tx, spec, user!.id, { existingSpineId: spineId });
            if (gl.journalEntryId === null) {
                throw new GlPostFailedError(
                    `Cannot post POS sale ${voucherRef}: engine produced no journal entry.`,
                    [],
                );
            }
            await tx.invVoucher.update({
                where: { id: voucher.id },
                data:  { universalVoucherId: gl.universalVoucherId },
            });

            // ── 3a. Coupon: log the redemption (enforces usage limits + powers
            // return reversal). Non-GL — the discount already posted as a charge.
            if (couponId != null && couponRupees > 0) {
                await recordCouponRedemption(tx, {
                    couponId,
                    accountId: isIdentified ? customerAccount.id : null,
                    universalVoucherId: spineId,
                    amount:    couponRupees,
                    channel:   "POS",
                });
            }

            // Gift card: draw down the balance (the GL leg was the tender above).
            if (giftCardId != null && giftCardRedeem > 0) {
                await redeemGiftCard(tx, { giftCardId, amount: giftCardRedeem, universalVoucherId: spineId, createdById: user!.id });
            }

            // ── 3b. Loyalty: redeem (consume oldest lots) + earn (new lot) ─
            // Identified customers only. Runs inside the tx so points move
            // atomically with the sale; a GL failure above already rolled back.
            let loyaltyResult = { pointsEarned: 0, pointsRedeemed: 0, newBalance: loyaltyBalance };
            let milestoneBonus = 0;
            let milestoneCoupons: string[] = [];
            if (loyaltyEnabled) {
                loyaltyResult = await applyLoyaltyForSale(tx, {
                    accountId:        customerAccount.id,
                    universalVoucherId: spineId,
                    earnLines,
                    combinedDiscount: effectiveTierDiscount + redemptionRupees + couponRupees,
                    redeemPoints,
                    invoiceValue:     invoiceValueGross,
                    rates:            loyaltyRates,
                    rulesIndex,
                    taxonomyMaps,
                    createdById:      user!.id,
                });

                // ── Milestone bonus points: award any lifetime-spend tier the
                // customer has now crossed (one-time per tier). Lifetime spend is
                // aggregated inside the tx so it includes the just-posted sale.
                if (milestoneTiers.length > 0) {
                    const spendAgg = await tx.invVoucher.aggregate({
                        where: { universalVoucher: { partyAccountId: customerAccount.id, status: "POSTED", deletedAt: null, type: { in: ["SALE", "POS"] } } },
                        _sum: { totalAmount: true },
                    });
                    const lifetimeSpend = Number(spendAgg._sum.totalAmount ?? 0);
                    const ms = await applyMilestones(tx, {
                        accountId:     customerAccount.id,
                        lifetimeSpend,
                        universalVoucherId: spineId,
                        milestones:    milestoneTiers,
                        rates:         loyaltyRates,
                        createdById:   user!.id,
                    });
                    milestoneBonus = ms.awarded.reduce((s, a) => s + a.points, 0);
                    milestoneCoupons = ms.issuedCouponCodes;
                    if (ms.awarded.length > 0) loyaltyResult.newBalance = ms.newBalance;
                }
            }

            // ── 4. Stock ledger + per-branch + org-wide stock decrement ───
            // Batched: one createMany for all ledger rows + per-product balance
            // updates (was one recordStockMovement — 3 writes — per line, serial
            // on the tx connection). Same net effect.
            const date = new Date(body.issueDate);
            await recordStockMovementsBatch(
                tx,
                computedLines
                    .filter((line) => Number(line.quantity) > 0)
                    .map((line) => ({
                        universalVoucherId: spineId,
                        productId: line.productId,
                        branchId:  activeBranchId,
                        date,
                        inQty:  0,
                        outQty: Number(line.quantity),
                        rate:   line.unitPrice,
                        amount: line.amount,
                    })),
            );

            // ── 5. Surplus (collect-on-the-go) ────────────────────────────
            // The customer paid MORE than the bill. Book the FULL inflow as ONE
            // Receipt voucher at its real tender ledger(s) — so UPI/bank reconciles
            // 1:1 with the statement — then allocate FIFO: this sale's JE first
            // (closes the AR tender above), then the oldest open bills; any leftover
            // stays as a customer advance (the unallocated Cr to the customer).
            let surplusCollected = 0;
            let arrearCleared    = 0;
            let advanceCredited  = 0;
            let receiptVoucherId:  number | null = null;
            let receiptVoucherRef: string | null = null;
            if (collectingSurplus) {
                surplusCollected = surplus;
                const allocations: { universalVoucherId: number; amount: number }[] = [
                    { universalVoucherId: gl.universalVoucherId!, amount: totalAmount },
                ];
                let remaining = surplus;
                for (const b of await getOpenSaleBillsForFifo(tx, customerAccount.id)) {
                    if (remaining <= 0.005) break;
                    if (b.universalVoucherId === gl.universalVoucherId) continue; // the sale just posted
                    const take = Math.min(remaining, b.outstanding);
                    if (take > 0.005) {
                        allocations.push({ universalVoucherId: b.universalVoucherId, amount: round2(take) });
                        remaining = round2(remaining - take);
                    }
                }
                arrearCleared   = round2(surplus - remaining);
                advanceCredited = round2(remaining);

                // Receipt tenders mirror the counter method→ledger map (cash→till,
                // UPI→upi, …); full inflow, carrying the UTR/reference.
                const receiptTenders = resolvedPayments.map((p) => ({
                    accountId:   p.accountId,
                    amount:      p.amount,
                    description: `${METHOD_LABEL[p.method]}${p.reference ? ` ref ${p.reference}` : ""}`,
                }));
                const narration = `POS surplus on ${voucherRef} — arrear ₹${arrearCleared.toFixed(2)}, advance ₹${advanceCredited.toFixed(2)}`;
                const receipt = await postReceiptVoucher(tx, {
                    customerAccountId: customerAccount.id,
                    tenders:           receiptTenders,
                    date:              new Date(body.issueDate),
                    userId:            user!.id,
                    branchId:          activeBranchId,
                    narration,
                    allocations,
                });
                receiptVoucherId  = receipt.voucherId;
                receiptVoucherRef = receipt.voucherRef;

                // Audit row tying the receipt to the shift (mirrors shifts/[id]/receipts).
                await tx.posReceipt.create({
                    data: {
                        shiftId:     shift.id,
                        amountPaise: BigInt(Math.round(paymentTotal * 100)),
                        accountId:   customerAccount.id,
                        note:        narration,
                        voucherId:   receipt.voucherId,
                        createdById: user!.id,
                    },
                });
            }

            return {
                voucherId:      voucher.id,
                voucherRef:     voucherRef,
                journalEntryId: gl.journalEntryId,
                shiftId:        shift.id,
                // Surplus outcome — surfaced on the POS success toast + print.
                surplusCollected,
                arrearCleared,
                advanceCredited,
                receiptVoucherId,
                receiptVoucherRef,
                // Loyalty outcome — surfaced on the POS success toast.
                pointsEarned:   loyaltyResult.pointsEarned,
                pointsRedeemed: loyaltyResult.pointsRedeemed,
                milestoneBonus,
                milestoneCoupons,
                loyaltyBalance: loyaltyResult.newBalance,
                // Coupon outcome — surfaced on the POS success toast.
                couponDiscount: couponRupees,
                couponCode:     couponRupees > 0 ? (body.couponCode ?? "auto") : null,
                giftCardRedeemed: giftCardRedeem,
                // Back-compat aliases — PosScreen still reads these names.
                invoiceId:      voucher.id,
                invoiceNumber:  voucherRef,
            };
        }, {
            // POS does voucher + GL post + per-line stock movement in ONE
            // interactive transaction. Each line costs ~3 sequential DB
            // round-trips (ledger insert + product-stock update + per-branch
            // upsert), so a large cart (10+ items) blows past Prisma's 5s
            // default and the transaction expires mid-sale ("query cannot be
            // executed on an expired transaction"). Match the office voucher
            // post route's window so big carts settle reliably.
            timeout: 30_000,
            maxWait: 10_000,
        });
        const _tTx = performance.now();

        const touchedProductIds = body.lines.map((l) => l.productId);
        // Pricing-cache refresh is NOT needed for the receipt response — defer it
        // past the response with after() (reliable on serverless, unlike a bare
        // fire-and-forget) so the cashier never waits on it.
        after(async () => {
            await recomputePricesForProducts(touchedProductIds).catch((err: unknown) => {
                Sentry.captureException(err, { tags: { source: "price-recompute", voucherId: String(result.voucherId) } });
                console.error("[price-recompute] failed for voucher", result.voucherId, err);
            });
        });

        // Resolved POS print template — the cashier lacks `settings:manage`, so
        // PosScreen can't fetch it directly. It rides the sale response and is
        // forwarded to the thermal relay so the printed slip respects the admin's
        // template and matches /receipt/invoice/[id]?kind=POS. Display-only.
        const posTemplate = await getVoucherTemplate("POS");
        console.log(`[pos-timing] ${result.invoiceNumber}: preTx=${Math.round(_tPreTx - _t0)}ms tx=${Math.round(_tTx - _tPreTx)}ms post=${Math.round(performance.now() - _tTx)}ms total=${Math.round(performance.now() - _t0)}ms (lines=${body.lines.length})`);
        return NextResponse.json({ ...result, posTemplate }, { status: 201 });
    } catch (err) {
        if (err instanceof CreditLimitError) {
            return NextResponse.json({ error: err.message, code: err.code }, { status: 422 });
        }
        if (err instanceof GlPostFailedError) {
            return NextResponse.json({ error: err.message, notes: err.notes }, { status: 500 });
        }
        console.error("[pos sale]", err);
        const msg = err instanceof Error ? err.message : "Failed to create POS sale";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
