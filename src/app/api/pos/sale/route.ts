import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse, after } from "next/server";
import { requirePosVoucher } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { invNextRef, calcVoucherTotals, calcLineTotals, resolveShippingGstRate } from "@/modules/inventory/lib/stock";
import { recordStockMovementsBatch } from "@/modules/inventory/lib/stockMovement";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import { resolveEffectiveCostMap } from "@/modules/pricing-strategy/lib/resolveCost";
import { saleToSpec } from "@/modules/accountancy/lib/voucherMappers";
import { buildSettlementJson, type ChargeInput } from "@/shared/lib/accountancy/settlement";
import { resolveServiceCharges, chargesNetTotal } from "@/shared/lib/accountancy/serviceCharges";
import { enginePost, engineCreateSpine } from "@/modules/accountancy/lib/transactionEngine";
import { syncVoucherLink } from "@/modules/accountancy/lib/voucherLinks";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";
import { postReceiptVoucher } from "@/modules/accountancy/lib/postReceiptVoucher";
import { channelToPaymentMethod } from "@/modules/pos/lib/counterTenders";
import { Prisma, type PaymentMethod } from "@/generated/prisma/client";
import { buildPartyJson } from "@/shared/lib/accountancy/partySnapshot";
import { getOpenSaleBillsForFifo } from "@/modules/accountancy/lib/outstandings";
import { getThermalTemplate } from "@/shared/lib/print/voucherTemplate";
import { buildVoucherBridgePayload } from "@/modules/accountancy/lib/voucherReceiptSample";
import { partyBalanceAroundVoucher } from "@/shared/lib/accountancy/partyLedgerBalance";
import * as Sentry from "@sentry/nextjs";
import { validateRequest } from "@/shared/lib/api";
import { checkCreditLimit, CreditLimitError } from "@/shared/lib/accountancy/checkCreditLimit";
import { round2 } from "@/shared/lib/format";
import { TIER_SPEND_VOUCHER_TYPES } from "@/shared/lib/pricing";
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
    selectCouponForCartById,
    selectOnTopCouponByCode,
    selectAutoOnTopCoupon,
    finalizeCouponAmount,
    couponExclusionMask,
    recordCouponRedemption,
    lookupActiveGiftCard,
    redeemGiftCard,
    GiftCardBalanceChangedError,
    type CartLineLite,
    type EvalInput,
    type CouponSelection,
} from "@/modules/coupons/lib";
import { resolveProductTax } from "@/modules/inventory/lib/gstResolver";
import { loadProtectedProductIds } from "@/modules/retention/lib/protection";
import { touchPosShift } from "@/modules/pos/lib/touchShift";
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
    productId: z.number().int().positive(),
    description: z.string().trim().min(1),
    quantity: z.number().positive(),
    unitPrice: z.number().min(0),
    taxRate: z.number().min(0).max(100).default(0),
    // Snapshots for the customer-facing "Today's discount" price ladder (paise).
    mrpPaise: z.number().int().nonnegative().nullish(),
    savedSalePricePaise: z.number().int().nonnegative().nullish(),
});

const paymentSchema = z.object({
    // Which counter payment account collected this — null = CASH (the till).
    // The server resolves its ledger + method from the counter's list.
    paymentAccountId: z.number().int().positive().nullable(),
    amount: z.number().positive(),
    reference: z.string().trim().max(120).optional(),
});

// Signed amount — positive raises the bill (Cr Income leg), negative lowers it
// (Dr Expense leg). Mirrors office SALE charges. accountId is the GL account
// the leg posts against.
const chargeSchema = z.object({
    accountId: z.number().int().positive(),
    description: z.string().trim().max(200).optional(),
    amount: z.number().refine((n) => Math.abs(n) >= 0.005, "Charge amount must be non-zero"),
});

// Service line (Settings → Services catalogue). The client sends only
// the id + qty + tax-EXCLUSIVE unit price; the server re-resolves the income
// ledger + GST rate from the catalogue — never trusted from the browser. Posts
// GL-only (Cr income net + Cr Output GST as a tax-bearing charge); no stock.
const serviceLineSchema = z.object({
    serviceId: z.number().int().positive(),
    description: z.string().trim().max(200).optional(),
    quantity: z.number().positive(),
    unitPrice: z.number().min(0),
});

const createSchema = z.object({
    accountId: z.number().int().positive(),                                       // customer AR account
    issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    notes: z.string().trim().optional(),
    // Goods lines. A sale may also be services-only — the cross-field refine
    // below enforces "at least one line OR one service".
    lines: z.array(lineSchema).default([]),
    services: z.array(serviceLineSchema).default([]),
    // May be empty: a fully-on-credit bill collects nothing at the counter.
    // What the customer may take on credit is decided by checkCreditLimit,
    // not by the shape of this array.
    payments: z.array(paymentSchema).default([]),
    shippingAmt: z.number().min(0).default(0),
    roundOff: z.number().default(0),  // signed
    charges: z.array(chargeSchema).default([]),
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
    // Force-apply a SPECIFIC coupon by id — AUTO offers have no code, so the
    // POS "Apply" button on an AUTO offer card carries its id instead.
    couponId: z.number().int().optional(),
    // When true (and no code), the server auto-applies the best eligible offer.
    autoApply: z.boolean().default(false),
    // Independent FREE-GRANT coupon (FREE_ITEM / BOGO) — applies ON TOP of the
    // money coupon: its item(s) are added as zero-price lines (quantity 0 +
    // freeQty, so stock + COGS move but no money) and it never drops tier,
    // blocks loyalty, or counts against the global guard.
    freeCouponCode: z.string().trim().max(40).optional(),
    // Force-apply a specific free-grant coupon by id (AUTO — no code).
    freeCouponId: z.number().int().optional(),
    // When true (no code), the server auto-selects the best eligible AUTO
    // free-grant coupon from the cart — a no-code AUTO FREE_ITEM / BOGO offer
    // fires on its own. Server-authoritative: re-derived here, never trusted
    // from the browser.
    freeAutoApply: z.boolean().default(false),
    // Gift-card code to redeem as a payment tender (server owns the ₹ drawn).
    giftCardCode: z.string().trim().max(40).optional(),
    // Collect-on-the-go: when true, the cashier is knowingly accepting MORE than
    // the bill. The surplus settles the customer's oldest open bills (FIFO) and
    // any leftover becomes a customer advance — booked as a separate Receipt
    // voucher so the bank/UPI statement matches 1:1. Requires an identified
    // customer; rejected alongside a gift-card redemption.
    collectSurplus: z.boolean().default(false),
    // Convert-to-sale: the source estimate/order this POS sale was rung up from.
    // Stored as refVoucherId so the source flips to "Converted".
    sourceVoucherId: z.number().int().positive().optional(),
    // Repair ticket this bill was raised from (Generate Bill on the ticket). The
    // voucher is linked to it (VoucherLink kind=TICKET) so it shows in the
    // ticket's Invoices panel, and a timeline entry is written on the ticket.
    ticketId: z.number().int().positive().optional().nullable(),
}).refine((d) => d.lines.length + d.services.length >= 1, {
    message: "At least one line item or service required",
    path: ["lines"],
});

class GlPostFailedError extends Error {
    constructor(message: string, public notes: string[]) { super(message); }
}

export async function POST(req: Request) {
    const { user, response } = await requirePosVoucher("sale", "create");
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
            where: { userId: user!.id, status: "OPEN" },
            select: {
                id: true, branchId: true,
                counter: {
                    select: {
                        id: true,
                        name: true,
                        tillAccountId: true,
                        paymentAccounts: {
                            where: { isActive: true },
                            select: { id: true, channel: true, accountId: true, label: true },
                        },
                    },
                },
            },
        }),
        prisma.account.findUnique({
            where: { id: body.accountId },
            select: {
                id: true, name: true, personId: true, companyId: true,
                person: { select: { name: true, noDiscount: true } },
                company: { select: { name: true, noDiscount: true } },
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
    const tillAccountId = shift.counter.tillAccountId;
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
    const partyId = customerAccount.personId
        ?? customerAccount.companyId
        ?? customerAccount.id;

    // ── Customer Quality: no-discount flag (server-authoritative) ─────────
    // Flagged customer bills at barcode price — ALL automatic benefits are
    // stripped here regardless of what the client sent (hard-coded all-block;
    // a settings toggle may refine the scope later): tier discount → 0,
    // coupons → skipped, loyalty earn + redeem → off. Silent by design — the
    // POS UI never learns the flag (the snapshot already previews zeros); the
    // cashier's manual price edits still apply as typed. Flag UI lives only on
    // the customer module's Quality tab (customers:edit).
    const noDiscountFlag =
        (customerAccount.person?.noDiscount ?? customerAccount.company?.noDiscount) === true;
    if (noDiscountFlag) {
        body.discountPct = 0;
        body.discountAmt = 0;
    }

    // ── Loyalty context ───────────────────────────────────────────────────
    // Only identified customers (a real Person/Company account) earn or redeem;
    // anonymous walk-in / counter ledgers never accrue points.
    const isIdentified = customerAccount.personId !== null || customerAccount.companyId !== null;
    const loyaltyRates = ratesFromConfig(loyaltyConfig);
    const loyaltyEnabled = isIdentified && loyaltyRates.enabled && !noDiscountFlag;
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

    // ── Resolve services (server-authoritative ledger + GST rate) ─────────
    // Each service line becomes a TAX-BEARING charge row: the service's ledger
    // takes the NET and its GST joins the voucher's Output CGST/SGST legs (see
    // buildInvVoucherGlLines). No stock, no loyalty earn, no coupon base.
    // Shared with the office vouchers and the counter's quotes, so a service
    // cannot land on one ledger here and another one there.
    const resolvedServices = await resolveServiceCharges(prisma, body.services);
    if (!resolvedServices.ok) {
        return NextResponse.json({ error: resolvedServices.error, code: resolvedServices.code }, { status: 422 });
    }
    const serviceCharges = resolvedServices.charges;
    // Customer-facing value of the services (net + GST) — rides chargesNet so
    // totalAmount, the tier/loyalty floors, and the JE all see the same bill.
    const serviceGross = chargesNetTotal(serviceCharges);

    // ── Shipping GST (composite supply — freight follows the bill) ────────
    // `shippingAmt` is tax-INCLUSIVE (customer pays exactly what the cashier
    // typed); back-calculate the embedded GST at the rate the bill dictates:
    // dominant >50% goods rate, else max rate — service rates when the bill
    // has no goods (resolveShippingGstRate). Weights are pre-tax, pre-discount
    // (qty × unitPrice) so the client hint computes the identical rate.
    // Unrounded like line/service tax — the engine rounds at the GL boundary.
    const shippingRateLines = body.lines.length > 0
        ? body.lines.map((l) => ({ value: l.quantity * l.unitPrice, taxRate: l.taxRate }))
        // A service-only bill weighs the service rates instead — `amount` is
        // already the pre-tax qty × rate the resolver computed.
        : serviceCharges.map((c) => ({ value: c.amount, taxRate: c.taxRate ?? 0 }));
    const shippingGstRate = body.shippingAmt > 0 ? resolveShippingGstRate(shippingRateLines) : 0;
    const shippingTaxAmt = (body.shippingAmt * shippingGstRate) / (100 + shippingGstRate);

    // ── Validate line items + payment totals ──────────────────────────────
    // goodsValue = pre-tax goods (Σ qty × unit price). grossTaxAmount = the tag GST
    // before any tier discount — drives the loyalty floors + coupon-stacking math.
    const goodsValue = body.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    const grossTaxAmount = body.lines.reduce((s, l) => s + (l.quantity * l.unitPrice * l.taxRate) / 100, 0);

    // ── Spend-tier discount: % of COST (incl. tax), applied per line BEFORE tax ──
    // Margin is a % of cost-incl (additivePrice), so the discount is too → margin%
    // and discount% at the same rate are the identical rupee amount (exact break-even).
    // The server RE-RESOLVES each line's cost from the ledger (never trusts the
    // client) via the product's effective cost method, then cuts each line's taxable
    // by `discount% × costExcl × qty` and lets calcLineTotals recompute GST on the
    // reduced base. Clamp to the line gross only (no margin floor — clearance may sell
    // below cost). No cost basis → no discount on that line. The per-line discount
    // nets into line.amount, so the voucher-level discountAmt is 0 (no separate
    // "Discount Allowed" leg — Sales + GST post net).
    const costPaiseById = await resolveEffectiveCostMap(body.lines.map((l) => l.productId));
    const costExclById = new Map<number, number | null>(
        [...costPaiseById].map(([id, paise]) => [id, paise == null ? null : paise / 100]),
    );
    // Discount-protection blacklist (Retention → Protection) — protected lines are
    // excluded from the tier discount, coupon eligibility, and loyalty entirely.
    const protectedProductIds = await loadProtectedProductIds(prisma);
    // Per-line pre-tax discount IF the tier applies (before the coupon-drop decision).
    const lineTierDiscExclRaw = body.lines.map((l) => {
        const c = costExclById.get(l.productId) ?? null;
        if (c == null || body.discountPct <= 0 || protectedProductIds.has(l.productId)) return 0;
        return Math.min((body.discountPct / 100) * c * l.quantity, l.quantity * l.unitPrice);
    });
    // Inclusive rupee effect (gross incl − net incl) — kept as the tier's voucher-level
    // number for the loyalty floors + coupon-stacking math (which reason about the
    // customer-facing discount), even though the discount now lives on the lines.
    const tierDiscount = body.lines.reduce((s, l, i) => {
        const gross = calcLineTotals({ quantity: l.quantity, rate: l.unitPrice, discountPct: 0, discountAmt: 0, taxRate: l.taxRate }).amount;
        const net = calcLineTotals({ quantity: l.quantity, rate: l.unitPrice, discountPct: 0, discountAmt: lineTierDiscExclRaw[i], taxRate: l.taxRate }).amount;
        return s + (gross - net);
    }, 0);

    // Pre-redemption invoice value — drives the min-invoice-to-earn and
    // min-invoice-to-redeem floors (the bill the customer would pay before any
    // loyalty redemption is applied).
    const manualChargesNet = body.charges.reduce((s, c) => s + c.amount, 0);
    const invoiceValueGross = goodsValue + grossTaxAmount + body.shippingAmt - tierDiscount + body.roundOff + manualChargesNet + serviceGross;

    // ── Pre-load loyalty earn context (reads, outside the tx) ──────────────
    // Resolves each line's taxonomy + the earn-rule index (earn multiplier AND
    // redeem-cap %) + group/category parent chains so both the per-line
    // multiplier and the cart-aware redeem ceiling (product → group → category →
    // global) can be computed. Skipped for walk-in / disabled — no extra queries.
    // Each line's product taxonomy (group / category / brand). Loyalty earn rules and
    // coupon include/exclude rules both need it, so it is loaded at most once and
    // shared — whichever feature runs first pays for the query.
    type LineTaxonomy = { groupId: number | null; categoryId: number | null; brandId: number | null };
    let taxById: Map<number, LineTaxonomy> | null = null;
    async function loadTaxonomy(): Promise<Map<number, LineTaxonomy>> {
        if (taxById) return taxById;
        const productIds = [...new Set(body.lines.map((l) => l.productId))];
        const products = await prisma.invProduct.findMany({
            where: { id: { in: productIds } },
            select: { id: true, groupId: true, categoryId: true, brandId: true },
        });
        taxById = new Map(products.map((p) => [p.id, { groupId: p.groupId, categoryId: p.categoryId, brandId: p.brandId }]));
        return taxById;
    }

    let earnLines: EarnLine[] = [];
    let rulesIndex = buildRulesIndex([]);
    let taxonomyMaps: TaxonomyMaps = { groupParent: new Map(), categoryParent: new Map() };
    if (loyaltyEnabled) {
        const [tax, groups, categories, rules] = await Promise.all([
            loadTaxonomy(),
            prisma.invProductGroup.findMany({ select: { id: true, parentId: true } }),
            prisma.invCategory.findMany({ select: { id: true, parentId: true } }),
            prisma.loyaltyEarnRule.findMany({ where: { enabled: true }, select: { scope: true, categoryId: true, groupId: true, productId: true, multiplier: true, redeemCapPct: true, enabled: true } }),
        ]);
        earnLines = body.lines.map((l) => {
            const p = tax.get(l.productId);
            return { productId: l.productId, groupId: p?.groupId ?? null, categoryId: p?.categoryId ?? null, goods: l.quantity * l.unitPrice };
        });
        rulesIndex = buildRulesIndex(rules.map((r) => ({ ...r, multiplier: Number(r.multiplier), redeemCapPct: r.redeemCapPct == null ? null : Number(r.redeemCapPct) })));
        taxonomyMaps = {
            groupParent: new Map(groups.map((g) => [g.id, g.parentId])),
            categoryParent: new Map(categories.map((c) => [c.id, c.parentId])),
        };
    }

    // ── Free-grant min-bill qualifier ───────────────────────────────────────
    // The tax-inclusive voucher total the customer pays — goods (incl. GST) +
    // shipping + charges + services − tier discount + round-off, before the money
    // coupon / loyalty redemption — the bill basis an independent FREE_ITEM / BOGO
    // free item qualifies against (its min-bill gate). Mirrors the client's
    // billAmountIncl so the POS preview and the posted grant always agree.
    const freeBillAmountIncl = round2(
        goodsValue + grossTaxAmount + body.shippingAmt + manualChargesNet + serviceGross - tierDiscount + body.roundOff,
    );

    // ── Coupon selection (moved ahead of the loyalty ceiling) ──────────────
    // The server resolves the code (or best AUTO offer) and OWNS the ₹ value. A
    // coupon discount rides the SAME negative-charge path as loyalty redemption,
    // to a dedicated "Coupon Discounts" ledger (postInvVoucherToGl untouched).
    // Selected here (not finalized yet) so its per-line matches can shape the
    // loyalty redeem ceiling below — LINE-scope exclusivity needs to know which
    // lines the coupon touches BEFORE the ceiling is computed, and BILL-scope
    // exclusivity (today's behavior) still hard-rejects points after the fact.
    let selected: CouponSelection = { kind: "none" };
    let freeSelected: Extract<CouponSelection, { kind: "free-grant" }> | null = null;
    /// Rule 2 — an independent PARTIAL FREE_ITEM / BOGO coupon: a ₹ discount ON
    /// TOP of the money coupon (no guard, no exclusivity mask).
    let onTopSelected: Extract<CouponSelection, { kind: "on-top" }> | null = null;
    let couponExpenseAccountId: number | null = null;
    let couponConfig: { couponExpenseAccountId: number | null; maxTotalDiscountPct: Prisma.Decimal | null } | null = null;
    let couponLines: CartLineLite[] = [];
    let couponInput: EvalInput | null = null;
    // customerAccount is narrowed to non-null above, but narrowing doesn't
    // survive into the nested buildCouponInput closure — capture the id once.
    const customerAccountId = customerAccount.id;
    // Coupon eligibility needs each line's taxonomy (include/exclude rules) +
    // the isNewCustomer verdict — shared by the money slot AND the free-grant
    // slot, so it is built once, on first demand.
    async function buildCouponInput(): Promise<EvalInput> {
        if (couponInput) return couponInput;
        const isNewCustomer = isIdentified
            // First-time buyer = no prior POSTED sale-type voucher on ANY
            // channel (SALE / POS / ONLINE_INVOICE — a webshop buyer isn't
            // "new" at the counter). Identified customers only.
            ? (await prisma.voucherDetail.count({ where: { universalVoucher: { partyAccountId: customerAccountId, status: "POSTED", deletedAt: null, type: { in: [...TIER_SPEND_VOUCHER_TYPES] } } } })) === 0
            : false;
        const tax = await loadTaxonomy();
        // Coupon lines carry NO cost — PERCENT coupons discount the SALE value,
        // so cost never reaches the customer math (cost is a business secret).
        couponLines = body.lines.map((l) => ({
            productId: l.productId,
            groupId: tax.get(l.productId)?.groupId ?? null,
            categoryId: tax.get(l.productId)?.categoryId ?? null,
            brandId: tax.get(l.productId)?.brandId ?? null,
            qty: l.quantity, unitPrice: l.unitPrice,
            // Discount-protected lines never match a coupon (see couponMath).
            protected: protectedProductIds.has(l.productId),
        }));
        couponInput = {
            accountId: isIdentified ? customerAccountId : null,
            lines: couponLines,
            goodsValue,
            // Tax-inclusive voucher total — the min-bill qualifier for the
            // GRANT / on-top gates (an independent free item, or a money-grant
            // item, qualifies against what the customer actually pays). Money
            // ₹ coupons ignore it (their min-bill stays on goods).
            billAmountIncl: freeBillAmountIncl,
            billBeforeCoupon: goodsValue,
            isNewCustomer,
            now: new Date(),
        };
        return couponInput;
    }
    // noDiscountFlag: coupons (typed code AND auto-offers, money and free-grant
    // alike) are skipped silently.
    if (!noDiscountFlag && (body.couponCode || body.autoApply || body.couponId != null)) {
        couponConfig = await prisma.couponConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
        couponExpenseAccountId = couponConfig.couponExpenseAccountId;
        selected = body.couponId != null
            // AUTO offer force-applied by id (no code to type).
            ? await selectCouponForCartById(prisma, {
                couponId: body.couponId, channel: "POS", input: await buildCouponInput(), protectedProductIds,
            })
            : await selectCouponForCart(prisma, {
                code: body.couponCode, autoApply: body.autoApply, channel: "POS", input: await buildCouponInput(), protectedProductIds,
            });
        if (selected.kind === "error") {
            return NextResponse.json({ error: selected.reason, code: "COUPON_REJECTED" }, { status: 422 });
        }
        // An independent FREE_ITEM / BOGO code typed into the coupon box isn't a
        // money ₹ — route it to the on-top slot (grant → free lines, partial →
        // ₹ on top).
        if (selected.kind === "free-grant") {
            freeSelected = selected;
            selected = { kind: "none" };
        } else if (selected.kind === "on-top") {
            onTopSelected = selected;
            selected = { kind: "none" };
        }
    }
    // On-top slot: an independent FREE_ITEM / BOGO coupon that applies ON TOP
    // of the money coupon. Never drops tier, never blocks loyalty, never hits
    // the guard — fully free grants free lines (rule 1), a partial adds its ₹
    // on top (rule 2).
    if (!noDiscountFlag && (body.freeCouponCode || body.freeCouponId != null)) {
        const sel = body.freeCouponId != null
            // AUTO on-top offer force-applied by id.
            ? await selectCouponForCartById(prisma, {
                couponId: body.freeCouponId, channel: "POS", input: { ...(await buildCouponInput()), billAmountIncl: freeBillAmountIncl }, protectedProductIds,
            })
            : await selectOnTopCouponByCode(prisma, {
                code: body.freeCouponCode!, channel: "POS", input: { ...(await buildCouponInput()), billAmountIncl: freeBillAmountIncl }, protectedProductIds,
            });
        if (sel.kind === "error") {
            return NextResponse.json({ error: sel.reason, code: "FREE_COUPON_REJECTED" }, { status: 422 });
        }
        if (sel.kind === "free-grant") freeSelected = sel;
        else if (sel.kind === "on-top") onTopSelected = sel;
        else {
            // A money coupon (₹ or rule-3 money-grant) can't ride the free slot.
            return NextResponse.json({ error: "This coupon gives a ₹ discount — apply it in the Coupon code box", code: "FREE_COUPON_REJECTED" }, { status: 422 });
        }
    }
    // Auto on-top: the best eligible independent AUTO FREE_ITEM / BOGO offer
    // (grant or partial), applied on top with no code (the client's
    // freeAutoApply flag — the server re-derives the grant/₹ from the cart, so
    // a stale client state can't drop it off the invoice).
    if (!noDiscountFlag && !freeSelected && !onTopSelected && body.freeAutoApply) {
        const sel = await selectAutoOnTopCoupon(prisma, {
            channel: "POS", input: { ...(await buildCouponInput()), billAmountIncl: freeBillAmountIncl }, protectedProductIds,
        });
        if (sel.kind === "free-grant") freeSelected = sel;
        else if (sel.kind === "on-top") onTopSelected = sel;
    }
    // Per-line exclusion mask for the selected coupon (all-false when none
    // selected). A money-grant (rule 3) is a MONEY coupon — its exclusivity
    // mask applies too; the on-top slot (rules 1-2) never touches tier/loyalty.
    const moneyWinner = selected.kind === "ok" || selected.kind === "money-grant" ? selected : null;
    const exclusionMask: boolean[] = moneyWinner ? couponExclusionMask(moneyWinner.coupon, couponLines) : body.lines.map(() => false);
    const lineScopeExclusive = moneyWinner != null && !moneyWinner.coupon.stackable && moneyWinner.coupon.stackScope === "LINE";
    const billScopeExclusive = moneyWinner != null && !moneyWinner.coupon.stackable && moneyWinner.coupon.stackScope === "BILL";

    // Server owns the redemption ₹ value — never trust the client. The ceiling is
    // cart-aware: Σ (line net × that item's redeem cap %), folding in the global
    // cap as the per-line default. LINE-scope exclusivity drops the coupon's own
    // matched lines out of the ceiling base entirely (they still can't earn/redeem
    // on this bill); BILL scope leaves the base untouched and instead hard-rejects
    // below, exactly as before.
    // LINE-scope exclusivity drops the coupon's own matched lines out of the
    // ceiling base (they still can't earn/redeem on this bill); BILL scope leaves
    // the base untouched and hard-rejects below instead. Discount-protected lines
    // are dropped from the base in EVERY case — no redemption against a protected
    // product. earnLines is index-aligned with body.lines.
    const earnLinesForCeiling = earnLines.filter((_, i) =>
        !protectedProductIds.has(body.lines[i].productId)
        && (!lineScopeExclusive || !exclusionMask[i]),
    );
    const requestedRedeem = loyaltyEnabled ? body.redeemPoints : 0;
    const redeemCeiling = loyaltyEnabled
        ? redeemableBaseForCart(earnLinesForCeiling, tierDiscount, rulesIndex, taxonomyMaps, loyaltyRates.maxRedeemPctOfBill)
        : 0;
    const redemption = clampRedemption(requestedRedeem, loyaltyBalance, redeemCeiling, invoiceValueGross, loyaltyRates);
    if (requestedRedeem > 0 && redemption.points === 0 && redemption.reason) {
        return NextResponse.json({ error: redemption.reason, code: "LOYALTY_REDEEM_REJECTED" }, { status: 422 });
    }
    const redeemPoints = redemption.points;
    const redemptionRupees = redemption.value;
    if (redemptionRupees > 0 && loyaltyConfig.redeemExpenseAccountId == null) {
        return NextResponse.json(
            { error: "Loyalty redemption ledger is not configured. Re-run the bootstrap seed.", code: "LOYALTY_LEDGER_MISSING" },
            { status: 422 },
        );
    }
    // BILL-scope exclusivity: unchanged behavior — reject outright so the cashier
    // sees why, rather than silently zeroing the points.
    if (billScopeExclusive && redeemPoints > 0) {
        return NextResponse.json(
            { error: "This coupon can't be combined with loyalty points. Remove the points to use it.", code: "COUPON_BLOCKS_LOYALTY" },
            { status: 422 },
        );
    }

    // ── Coupon finalize ─────────────────────────────────────────────────────
    // Per-line tier discount with the excluded lines zeroed — mask[i] true means
    // this line loses its tier discount to the coupon's exclusivity. Unlike the
    // old single bill-wide scalar, this is exact per-line so LINE scope only
    // zeroes the lines the coupon itself matches.
    const lineTierDiscAfterCoupon = lineTierDiscExclRaw.map((v, i) => (exclusionMask[i] ? 0 : v));
    const tierDiscountAfterCoupon = body.lines.reduce((s, l, i) => {
        const gross = calcLineTotals({ quantity: l.quantity, rate: l.unitPrice, discountPct: 0, discountAmt: 0, taxRate: l.taxRate }).amount;
        const net = calcLineTotals({ quantity: l.quantity, rate: l.unitPrice, discountPct: 0, discountAmt: lineTierDiscAfterCoupon[i], taxRate: l.taxRate }).amount;
        return s + (gross - net);
    }, 0);
    // Money slot: a ₹ coupon (rule 4) is guard-finalized; a money-grant (rule
    // 3) has no ₹ (its item is granted as free lines instead). The on-top slot
    // (rule 2) adds its ₹ on top of the money ₹ — never guard-clamped.
    let couponRupees = 0;
    let couponId: number | null = null;
    if (selected.kind === "ok" && couponConfig) {
        const fin = finalizeCouponAmount({
            selectedDiscount: selected.discountRupees,
            tierRupees: tierDiscountAfterCoupon,
            loyaltyRupees: redemptionRupees,
            goodsValue,
            maxTotalDiscountPct: couponConfig.maxTotalDiscountPct != null ? Number(couponConfig.maxTotalDiscountPct) : null,
        });
        couponRupees = fin.couponRupees;
        couponId = selected.coupon.id;
    } else if (selected.kind === "money-grant") {
        couponId = selected.coupon.id;
    }
    const onTopRupees = onTopSelected?.discountRupees ?? 0;
    // Any ₹ discount (money or on-top) needs the coupon expense ledger.
    if ((couponRupees > 0 || onTopRupees > 0) && couponExpenseAccountId == null) {
        return NextResponse.json(
            { error: "Coupon ledger is not configured. Re-run the bootstrap seed.", code: "COUPON_LEDGER_MISSING" },
            { status: 422 },
        );
    }
    const computedLines: Array<{
        productId: number; description: string; quantity: number; freeQty: number;
        unitPrice: number; taxRate: number; discountAmt: number; discountPct: number;
        taxAmount: number; amount: number; mrpPaise: number | null; savedSalePricePaise: number | null;
    }> = body.lines.map((l, i) => {
        const discountAmt = round2(lineTierDiscAfterCoupon[i]);
        const { taxAmount: lineTax, amount } = calcLineTotals({
            quantity: l.quantity, rate: l.unitPrice, discountPct: 0, discountAmt, taxRate: l.taxRate,
        });
        return {
            productId: l.productId,
            description: l.description,
            quantity: l.quantity,
            freeQty: 0,
            unitPrice: l.unitPrice,
            taxRate: l.taxRate,
            // Per-line spend-tier discount (pre-tax); discountPct is the configured
            // tier % (record only — the displayed % is derived synthetically).
            discountAmt,
            discountPct: body.discountPct,
            taxAmount: lineTax,
            amount,
            // Customer-facing ladder snapshots (paise) — display only.
            mrpPaise: l.mrpPaise ?? null,
            savedSalePricePaise: l.savedSalePricePaise ?? null,
        };
    });
    // Free-grant lines (rule 1 on-top grant + rule 3 money-grant): the granted
    // item rides the bill as a zero-price line — quantity 0 + freeQty, so stock
    // and COGS move (the margin engine counts free units as real cost given
    // away) but the bill math (subtotal / tax / totals) is untouched. No
    // discount charge, no guard — grants are ₹-less by design.
    const freeLinesOut: { productId: number; freeQty: number; productName: string }[] = [];
    const grantWinners: Array<{ grant: { productId: number; freeQty: number }; couponName: string }> = [
        ...(freeSelected ? [{ grant: freeSelected.grant, couponName: freeSelected.coupon.name }] : []),
        ...(selected.kind === "money-grant" ? [{ grant: selected.grant, couponName: selected.coupon.name }] : []),
    ];
    for (const { grant, couponName } of grantWinners) {
        const tax = await resolveProductTax(grant.productId);
        const rate = tax.taxability == null || tax.taxability === "TAXABLE" ? (tax.gstRate ?? 0) : 0;
        const freeProduct = await prisma.invProduct.findUnique({ where: { id: grant.productId }, select: { name: true } });
        computedLines.push({
            productId: grant.productId,
            description: `FREE · ${couponName}`,
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
    // Net GST after the per-line tier discount — what actually posts + prints.
    const taxAmount = computedLines.reduce((s, l) => s + l.taxAmount, 0);

    // Money ₹ + on-top ₹ ride the same negative charge (one leg on the "Coupon
    // Discounts" ledger). The on-top part is NOT guard-clamped — it is
    // independent by design; couponRupees already went through the guard.
    const couponDiscountTotal = couponRupees + onTopRupees;
    const couponCharge = couponDiscountTotal > 0 && couponExpenseAccountId != null
        ? { accountId: couponExpenseAccountId, description: `Coupon: ${body.couponCode ?? "auto"}`, amount: -couponDiscountTotal }
        : null;

    // Loyalty redemption as a negative charge row on the dedicated ledger. Posts
    // Dr "Loyalty Points Redeemed" via postInvVoucherToGl's charge handling and
    // lowers the bill via chargesNet — no change to the protected GL math.
    const loyaltyCharge = redemptionRupees > 0 && loyaltyConfig.redeemExpenseAccountId != null
        ? { accountId: loyaltyConfig.redeemExpenseAccountId, description: `Loyalty: ${redeemPoints} pts redeemed`, amount: -redemptionRupees }
        : null;
    const allCharges: ChargeInput[] = [
        ...body.charges,
        ...serviceCharges,
        ...(loyaltyCharge ? [loyaltyCharge] : []),
        ...(couponCharge ? [couponCharge] : []),
    ];

    // chargesNet feeds totalAmount, so tax-bearing rows (services) contribute
    // their GROSS — the GL splits it back into net (charge leg) + GST (tax legs).
    // Rounded per row, matching the cart's own per-line figures.
    const chargesNet = chargesNetTotal(allCharges);
    // Σ per-line pre-tax tier discount — stored as the voucher-level discountAmt so
    // the engine still posts the "Discount Allowed" leg (P&L visibility kept). To keep
    // the JE balanced with NET lines, subtotal is stored GROSS of that discount:
    //   goodsAmount = subtotal − taxAmount  → full gross goods  (Cr Sales)
    //   Dr Discount Allowed = discountAmt   (pre-tax — the GST share was never revenue)
    //   Cr GST = net taxAmount              (recomputed on the discounted base)
    // and totalAmount = subtotal + shipping − discountAmt + roundOff + chargesNet
    // still reconciles because the lines already carry the netting.
    const tierPretaxDiscount = round2(computedLines.reduce((s, l) => s + l.discountAmt, 0));
    const netTotals = calcVoucherTotals(
        computedLines,           // already NET of the per-line tier discount
        body.shippingAmt,
        0,                       // discount enters via the stored gross subtotal below
        body.roundOff,
        chargesNet,              // includes the negative loyalty + coupon charges
    );
    const subtotal = round2(netTotals.subtotal + tierPretaxDiscount);
    const totalAmount = netTotals.totalAmount;

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
    //   • exact (|surplus| ≤ 1p) → the plain paid-in-full counter sale.
    //   • under (surplus < 0)    → an on-credit sale. The shortfall rides the
    //     customer's own ledger as an AR tender; how much they may take is
    //     checkCreditLimit's call (inside the tx, below) — max(manual, auto)
    //     against their effective balance. Nothing collected at all is a
    //     fully-on-credit bill, and is fine by the same rule.
    //   • over  (surplus > 0)    → allowed ONLY with collectSurplus: the extra
    //     settles the customer's oldest open bills (FIFO) + leftover advance, via
    //     a separate Receipt voucher (so the bank/UPI statement matches 1:1).
    const paymentTotal = body.payments.reduce((s, p) => s + p.amount, 0) + giftCardRedeem;
    const surplus = round2(paymentTotal - totalAmount);
    const collectingSurplus = surplus > 0.01;
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

    // Amount that will increase the customer's AR balance (onCredit portion) —
    // what checkCreditLimit weighs against the customer's effective limit.
    // Round to paise: the inclusive-price + roundOff float math can leave a
    // sub-paise residue (e.g. totalAmount = 960.0000000000004 vs a ₹960 payment).
    // That crumb is not a real credit balance, but left unrounded it slips past
    // the ±0.01 payment-match guard yet still trips checkCreditLimit's
    // `additionalDebit > 0` test — wrongly rejecting a fully-paid sale to a
    // zero-credit-limit customer with NO_CREDIT_ALLOWED.
    //
    // round2 alone is NOT enough: a residue of ~0.005 (common once a GST-bearing
    // charge is on the bill) rounds UP to 0.01, which is still > 0 and still
    // trips the guard. A shortfall within ±0.01 is a rounding crumb — not a
    // customer taking credit — so it is zeroed and the limit is left alone.
    // (The crumb still rides the AR tender below, which is what keeps the
    // tender rows adding up to the bill.)
    const rawOnCredit = round2(totalAmount - paymentTotal);
    const onCredit = rawOnCredit > 0.01 ? rawOnCredit : 0;

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
            // No explicit counter: numberingCounter() numbers the sale under the
            // counter it is raised at — this till, or a v_live till relaying it to
            // the office — and the office's own sales as counter 1 (2026-09-25).
            const voucherRef = await invNextRef(tx, "POS");
            // Whatever the counter did not collect goes on the customer's own
            // ledger as an AR tender, so the tender rows always add up to the
            // bill and the GL balances (Dr Customer instead of Dr Till).
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
                        amount: p.amount,
                        method: p.method,
                        reference: p.reference ?? null,
                    })),
                    // Gift-card tender — Dr "Gift Card Liability" (bypasses counterMethodMap;
                    // its ledger is the liability, not the counter wallet).
                    ...(giftCardRedeem > 0.005 && giftCardLiabilityAccountId != null
                        ? [{ accountId: giftCardLiabilityAccountId, amount: giftCardRedeem, method: "OTHER" as const, reference: `Gift card ${body.giftCardCode}` }]
                        : []),
                    // AR leg for the unpaid portion (on-credit) — the bill then
                    // shows up in the customer's outstandings and ages like any
                    // other open bill.
                    ...(arRemainder > 0.005
                        ? [{ accountId: customerAccount.id, amount: arRemainder, method: null as null, reference: null as null }]
                        : []),
                ];
            // Phase 5 5.0/5C: spine FIRST (the document anchor) so goods lines hang
            // off it; enginePost attaches the GL lines + flips it via existingSpineId.
            const voucherDescription = body.notes?.trim() || `POS sale — ${partyName}`;
            const spineId = await engineCreateSpine(tx, {
                type: "POS",
                date: new Date(body.issueDate),
                description: voucherDescription,
                voucherNo: voucherRef,
                partyAccountId: customerAccount.id,
                branchId: activeBranchId,   // 5D-12: branch primary on the spine
                userId: user!.id,
            });
            // Link the bill to the repair ticket it was raised from (if any), so it
            // surfaces in the ticket's Invoices panel (VoucherLink kind=TICKET).
            if (body.ticketId) await syncVoucherLink(tx, spineId, "TICKET", body.ticketId);
            const voucher = await tx.voucherDetail.create({
                data: {
                    // 5D-11/5D-12: type + branch live on the spine (engineCreateSpine set them).
                    universalVoucherId: spineId,
                    // Convert-to-sale link → marks the source estimate/order "Converted".
                    refVoucherId: body.sourceVoucherId ?? null,
                    // 5D-5/5D-8/5D-10: description + postedAt + status + date + 5D-4 party live on the spine.
                    partyJson: buildPartyJson({ name: partyName }) ?? Prisma.DbNull,
                    partyType,
                    partyId,
                    deliveryMode: "COUNTER",
                    placeOfSupply: sellerStateCode,
                    shippingAmt: body.shippingAmt,
                    shippingTaxAmt: round2(shippingTaxAmt),
                    // Pre-tax tier discount total (Σ line discountAmt). Stored with the
                    // GROSS subtotal above so the engine posts the "Discount Allowed"
                    // leg exactly as before — only the amount's base changed (% of
                    // cost, pre-tax). discountPct stays the configured tier % — the
                    // receipt's tier-name lookup key when the tier actually applied.
                    discountAmt: tierPretaxDiscount,
                    discountPct: tierDiscountAfterCoupon > 0 ? body.discountPct : 0,
                    roundOff: body.roundOff,
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
                    productId: l.productId,
                    description: l.description,
                    quantity: l.quantity,
                    // Free-grant lines carry quantity 0 + freeQty — the receipt
                    // prints them as "1 × Fanta FREE" and the ledger moves qty+free.
                    freeQty: l.freeQty > 0 ? l.freeQty : null,
                    rate: l.unitPrice,
                    taxRate: l.taxRate,
                    // Per-line spend-tier discount (pre-tax) — netted into amount/tax.
                    discountAmt: l.discountAmt,
                    discountPct: l.discountPct,
                    taxAmount: l.taxAmount,
                    amount: l.amount,
                    mrpPaise: l.mrpPaise,
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
                id: voucher.id,
                type: "POS",   // 5D-11: type on the spine
                reference: voucherRef,
                date: new Date(body.issueDate),   // 5D-10: date on the spine (attach-mode ignores spec.date)
                description: voucherDescription,
                partyJson: voucher.partyJson,
                subtotal: voucher.subtotal,
                taxAmount: voucher.taxAmount,
                shippingAmt: voucher.shippingAmt,
                // UNROUNDED (matches line/service tax) — the engine rounds each leg once.
                shippingTaxAmt,
                discountAmt: voucher.discountAmt,
                roundOff: voucher.roundOff,
                totalAmount: voucher.totalAmount,
                // Tenders/charges straight from the in-memory input (no DB round-trip).
                tenders: tenderPayload.map((t) => ({ accountId: t.accountId, amount: Number(t.amount), method: t.method, reference: t.reference })),
                charges: allCharges.map((c) => ({ accountId: c.accountId, amount: Number(c.amount), description: c.description, taxAmount: c.taxAmount ?? null })),
                sellerStateCode,
                buyerStateCode: sellerStateCode, // counter pickup → intra-state
            });
            const gl = await enginePost(tx, spec, user!.id, { branchId: activeBranchId, existingSpineId: spineId });
            if (gl.journalEntryId === null) {
                throw new GlPostFailedError(
                    `Cannot post POS sale ${voucherRef}: engine produced no journal entry.`,
                    [],
                );
            }
            await tx.voucherDetail.update({
                where: { id: voucher.id },
                data: { universalVoucherId: gl.universalVoucherId },
            });

            // ── 3a. Coupon: log the redemption(s) (enforces usage limits +
            // powers return reversal). Non-GL — the discount already posted as
            // a charge. A money-grant (rule 3) records amount 0 like a grant —
            // its slot is the money one, but it is ₹-less.
            if (couponId != null && (couponRupees > 0 || selected.kind === "money-grant")) {
                await recordCouponRedemption(tx, {
                    couponId,
                    accountId: isIdentified ? customerAccount.id : null,
                    universalVoucherId: spineId,
                    amount: couponRupees,
                    channel: "POS",
                });
            }
            // On-top partial (rule 2): its own redemption with its ₹.
            if (onTopSelected && onTopRupees > 0) {
                await recordCouponRedemption(tx, {
                    couponId: onTopSelected.coupon.id,
                    accountId: isIdentified ? customerAccount.id : null,
                    universalVoucherId: spineId,
                    amount: onTopRupees,
                    channel: "POS",
                });
            }
            // Free-grant coupon (rule 1): log its redemption too (usage limits
            // apply — amount 0, because a free grant is ₹-less by design; the
            // row still enforces total/per-customer caps and reverses on a full
            // return).
            if (freeSelected) {
                await recordCouponRedemption(tx, {
                    couponId: freeSelected.coupon.id,
                    accountId: isIdentified ? customerAccount.id : null,
                    universalVoucherId: spineId,
                    amount: 0,
                    channel: "POS",
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
                    accountId: customerAccount.id,
                    universalVoucherId: spineId,
                    // Protected lines neither earn nor redeem — filtered out of
                    // the earn base (index-aligned with the unfiltered array).
                    earnLines: earnLines.filter((_, i) => !protectedProductIds.has(body.lines[i].productId)),
                    combinedDiscount: tierDiscountAfterCoupon + redemptionRupees + couponRupees,
                    redeemPoints,
                    invoiceValue: invoiceValueGross,
                    rates: loyaltyRates,
                    rulesIndex,
                    taxonomyMaps,
                    createdById: user!.id,
                });

                // ── Milestone bonus points: award any lifetime-spend tier the
                // customer has now crossed (one-time per tier). Lifetime spend is
                // aggregated inside the tx so it includes the just-posted sale.
                if (milestoneTiers.length > 0) {
                    // Every sale channel counts toward milestone lifetime spend.
                    const spendAgg = await tx.voucherDetail.aggregate({
                        where: { universalVoucher: { partyAccountId: customerAccount.id, status: "POSTED", deletedAt: null, type: { in: [...TIER_SPEND_VOUCHER_TYPES] } } },
                        _sum: { totalAmount: true },
                    });
                    const lifetimeSpend = Number(spendAgg._sum.totalAmount ?? 0);
                    const ms = await applyMilestones(tx, {
                        accountId: customerAccount.id,
                        lifetimeSpend,
                        universalVoucherId: spineId,
                        milestones: milestoneTiers,
                        rates: loyaltyRates,
                        createdById: user!.id,
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
                    .filter((line) => Number(line.quantity) > 0 || Number(line.freeQty) > 0)
                    .map((line) => ({
                        universalVoucherId: spineId,
                        productId: line.productId,
                        branchId: activeBranchId,
                        date,
                        inQty: 0,
                        // Free units leave the shelf like any other (the ledger
                        // records qty+free so stock, margin and movement-class
                        // all agree the item physically went out).
                        outQty: Number(line.quantity) + Number(line.freeQty),
                        rate: line.unitPrice,
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
            let arrearCleared = 0;
            let advanceCredited = 0;
            let receiptVoucherId: number | null = null;
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
                arrearCleared = round2(surplus - remaining);
                advanceCredited = round2(remaining);

                // Receipt tenders mirror the counter method→ledger map (cash→till,
                // UPI→upi, …); full inflow, carrying the UTR/reference.
                const receiptTenders = resolvedPayments.map((p) => ({
                    accountId: p.accountId,
                    amount: p.amount,
                    description: `${METHOD_LABEL[p.method]}${p.reference ? ` ref ${p.reference}` : ""}`,
                }));
                const narration = `POS surplus on ${voucherRef} — arrear ₹${arrearCleared.toFixed(2)}, advance ₹${advanceCredited.toFixed(2)}`;
                const receipt = await postReceiptVoucher(tx, {
                    customerAccountId: customerAccount.id,
                    tenders: receiptTenders,
                    date: new Date(body.issueDate),
                    userId: user!.id,
                    branchId: activeBranchId,
                    narration,
                    allocations,
                    // Ties the surplus receipt to the shift on the voucher itself
                    // (mirrors shifts/[id]/receipts).
                    shiftId: shift.id,
                });
                receiptVoucherId = receipt.voucherId;
                receiptVoucherRef = receipt.voucherRef;

                await touchPosShift(tx, shift.id);
            }

            return {
                voucherId: voucher.id,
                voucherRef: voucherRef,
                universalVoucherId: spineId,
                journalEntryId: gl.journalEntryId,
                shiftId: shift.id,
                // Surplus outcome — surfaced on the POS success toast + print.
                surplusCollected,
                arrearCleared,
                advanceCredited,
                receiptVoucherId,
                receiptVoucherRef,
                // Loyalty outcome — surfaced on the POS success toast.
                pointsEarned: loyaltyResult.pointsEarned,
                pointsRedeemed: loyaltyResult.pointsRedeemed,
                milestoneBonus,
                milestoneCoupons,
                loyaltyBalance: loyaltyResult.newBalance,
                // Coupon outcome — surfaced on the POS success toast (money ₹ +
                // on-top ₹; a money-grant reports 0 and its free items below).
                couponDiscount: couponDiscountTotal,
                couponCode: couponDiscountTotal > 0 ? (body.couponCode ?? "auto") : null,
                // Free-grant outcome — the free items added to the bill (zero
                // price; the receipt prints them with the FREE badge).
                freeCouponId: freeSelected?.coupon.id ?? null,
                freeCouponCode: freeSelected?.coupon.code ?? null,
                freeItems: freeLinesOut,
                giftCardRedeemed: giftCardRedeem,
                // Back-compat aliases — PosScreen still reads these names.
                invoiceId: voucher.id,
                invoiceNumber: voucherRef,
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

        // Repair-ticket timeline entry — records the bill, its link, and whether
        // it was paid in full / partly on credit / fully on credit. Best-effort:
        // a failure here never fails the (already committed) sale.
        if (body.ticketId) {
            try {
                const billTotal = round2(totalAmount);
                const paid = round2(Math.min(paymentTotal, billTotal));
                const credit = round2(onCredit);
                const payStatus = credit <= 0.01 ? "full" : paid <= 0.01 ? "credit" : "partial";
                const payLabel =
                    payStatus === "full" ? "Paid in full"
                        : payStatus === "credit" ? `On credit — ₹${credit.toFixed(2)} due`
                            : `Partial — paid ₹${paid.toFixed(2)}, ₹${credit.toFixed(2)} on credit`;
                const t = await prisma.ticket.findUnique({ where: { id: body.ticketId }, select: { status: true } });
                if (t) {
                    const author = await buildActorSnapshot(user!.id);
                    await prisma.ticketLog.create({
                        data: {
                            ticketId: body.ticketId,
                            status: t.status,
                            note: `Bill ${result.voucherRef} · ₹${billTotal.toFixed(2)} · ${payLabel}`,
                            visibility: "INTERNAL",
                            author,
                            data: {
                                bill: {
                                    voucherId: result.voucherId,
                                    voucherRef: result.voucherRef,
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

        // Thermal-resolved POS print template — the cashier lacks `settings:manage`,
        // so PosScreen can't fetch it directly. It rides the sale response and is
        // forwarded to the thermal relay so the printed slip obeys the template's
        // *Thermal* toggles and matches /receipt/invoice/[id]?kind=POS. The
        // overpayment Receipt voucher (RV-…) rides along the same way, built by
        // the same helper as every other Receipt print. Display-only.
        const posTemplateP = getThermalTemplate("POS");
        const [posTemplate, receiptPrint, ledgerBalance] = await Promise.all([
            posTemplateP,
            result.receiptVoucherId ? buildVoucherBridgePayload("gl", result.receiptVoucherId) : null,
            // The customer's running account for the slip's Previous / Closing
            // balance — read only when the template prints it, and never for the
            // walk-in ledger (it pools every walk-in). The bill and its RV-… are
            // one visit, exactly as the reprint counts them (billSettlementPrint).
            isIdentified
                ? posTemplateP.then((t) => t.showPartyBalance
                    ? partyBalanceAroundVoucher(customerAccount.id, [result.universalVoucherId, ...(result.receiptVoucherId ? [result.receiptVoucherId] : [])])
                    : null)
                : null,
        ]);
        const partyBalance = ledgerBalance
            ? { before: ledgerBalance.format(ledgerBalance.before), after: ledgerBalance.format(ledgerBalance.after) }
            : null;
        console.log(`[pos-timing] ${result.invoiceNumber}: preTx=${Math.round(_tPreTx - _t0)}ms tx=${Math.round(_tTx - _tPreTx)}ms post=${Math.round(performance.now() - _tTx)}ms total=${Math.round(performance.now() - _t0)}ms (lines=${body.lines.length})`);
        return NextResponse.json({ ...result, posTemplate, receiptPrint, partyBalance }, { status: 201 });
    } catch (err) {
        if (err instanceof CreditLimitError) {
            return NextResponse.json({ error: err.message, code: err.code }, { status: 422 });
        }
        if (err instanceof GlPostFailedError) {
            return NextResponse.json({ error: err.message, notes: err.notes }, { status: 500 });
        }
        if (err instanceof GiftCardBalanceChangedError) {
            return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
        }
        console.error("[pos sale]", err);
        const msg = err instanceof Error ? err.message : "Failed to create POS sale";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
