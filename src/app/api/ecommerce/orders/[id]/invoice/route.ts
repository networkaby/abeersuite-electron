import { NextResponse, type NextRequest } from "next/server";
import { systemBranchId } from "@/shared/lib/org/systemBranch";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { Prisma } from "@/generated/prisma/client";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { requestBusinessDate } from "@/shared/lib/api/requestBusinessDate";
import { resolveProductTax } from "@/modules/inventory/lib/gstResolver";
import { stateCodeForName } from "@/shared/lib/gst/indianStates";
import { syncVoucherLinks } from "@/modules/accountancy/lib/voucherLinks";
import { invNextRef, calcLineTotals, calcVoucherTotals, resolveShippingGstRate } from "@/modules/inventory/lib/stock";
import { engineCreateSpine, enginePost, voucherDebitTotal } from "@/modules/accountancy/lib/transactionEngine";
import { saleToSpec } from "@/modules/accountancy/lib/voucherMappers";
import { buildPartyJson } from "@/shared/lib/accountancy/partySnapshot";
import { buildSettlementJson } from "@/shared/lib/accountancy/settlement";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import { round2 } from "@/shared/lib/format";
import { TIER_SPEND_VOUCHER_TYPES } from "@/shared/lib/pricing";
import {
    ratesFromConfig,
    liveBalance,
    buildRulesIndex,
    applyLoyaltyForSale,
    applyMilestones,
    type EarnLine,
    type TaxonomyMaps,
    type MilestoneTier,
} from "@/modules/loyalty/lib";
import { loadProtectedProductIds } from "@/modules/retention/lib/protection";

// POST /api/ecommerce/orders/[id]/invoice
//
// ONE-CLICK convert: shop order → posted ONLINE_INVOICE, built with the SAME
// primitives as a POS sale (technically the same voucher structure):
//
//   1. Per-line GST: shop prices are tax-INCLUSIVE — resolve each product's rate
//      and back out the pre-tax rate, floats unrounded (engine rounds once).
//   2. The checkout-frozen spend-tier discount replays per line as its pre-tax
//      `discountAmt` — GST recomputes on the reduced base, subtotal is stored
//      GROSS of the discount and the voucher-level `discountAmt` posts the
//      "Discount Allowed" leg, exactly like /api/pos/sale.
//   3. Shipping carries GST (composite supply): the courier charge is
//      tax-inclusive; its embedded GST (rate via resolveShippingGstRate —
//      dominant >50% goods rate, else max) posts on the tax legs while
//      Shipping Income earns the net.
//   4. Spine + VoucherDetail + lines + settlementJson (single customer-AR
//      tender — a CREDIT sale) → `saleToSpec` + `enginePost` writes the
//      balanced JE AND the stock OUT atomically (no HTTP self-calls).
//   5. Reservation hold → EXECUTED, link invoice ↔ order (VoucherLink
//      SHOP_ORDER), allocate the order's advance RECEIPT so AR nets out.
//
// Idempotent: an existing non-cancelled linked invoice is returned as-is. The
// posted voucher is a NORMAL voucher afterwards — editable via the accountancy
// module like any other (no special lock).

class GlPostFailedError extends Error {}

/** Live (non-cancelled) invoice already linked to this order, if any. */
async function findLinkedInvoice(orderId: number) {
    const links = await prisma.voucherLink.findMany({
        where: { kind: "SHOP_ORDER", targetId: String(orderId) },
        select: { universalVoucherId: true },
    });
    if (links.length === 0) return null;
    return prisma.universalVoucher.findFirst({
        where: {
            id: { in: links.map((l) => l.universalVoucherId) },
            status: { not: "CANCELLED" },
            deletedAt: null,
        },
        select: {
            id: true,
            voucherNo: true,
            status: true,
            type: true,
            voucherDetail: { select: { id: true, totalAmount: true } },
        },
    });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireModuleAccess("e-commerce");
    if (response) return response;
    const { id } = await ctx.params;
    const oid = parseInt(id, 10);
    if (!Number.isFinite(oid)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    try {
        // Idempotent: one live invoice per order.
        const existing = await findLinkedInvoice(oid);
        if (existing?.voucherDetail) {
            return NextResponse.json({
                already: true,
                invoiceId: existing.voucherDetail.id,
                reference: existing.voucherNo,
            });
        }

        const t = await prisma.ticket.findUnique({
            where: { id: oid },
            select: {
                accountId: true,
                account: { select: { personId: true, companyId: true, name: true } },
                order: {
                    select: {
                        totalPaise: true,
                        shippingChargePaise: true,
                        tierDiscountPaise: true,
                        tierDiscountPct: true,
                        tierLabel: true,
                        couponId: true,
                        couponCode: true,
                        couponDiscountPaise: true,
                        couponRedemptionId: true,
                        freeCouponCode: true,
                        freeCouponRedemptionId: true,
                        onTopCouponCode: true,
                        onTopDiscountPaise: true,
                        onTopRedemptionId: true,
                        loyaltyRedeemPoints: true,
                        loyaltyRedeemPaise: true,
                        shippingName: true,
                        shippingAddress: true,
                        lines: {
                            select: {
                                productId: true,
                                quantity: true,
                                freeQty: true,
                                unitPricePaise: true,
                                tierDiscountPaise: true,
                                product: { select: { name: true, mrpPaise: true, stock: true, groupId: true, categoryId: true } },
                            },
                        },
                    },
                },
            },
        });
        if (!t?.order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
        if (t.order.lines.length === 0) {
            return NextResponse.json({ error: "Order has no lines to invoice." }, { status: 400 });
        }
        if (!t.accountId) {
            return NextResponse.json(
                { error: "This order has no customer account to invoice — attach a customer first." },
                { status: 400 },
            );
        }
        const accountId = t.accountId;

        // 1+2. Per-line GST back-out + the frozen tier discount as the line's
        // pre-tax discountAmt (identical math to a POS sale line).
        const computedLines: {
            productId: number; description: string; quantity: number; rate: number;
            taxRate: number; discountAmt: number; taxAmount: number; amount: number; freeQty: number;
            savedSalePricePaise: number | null; mrpPaise: number | null;
            product: { stock: number | null } | null;
        }[] = [];
        for (const l of t.order.lines) {
            // Independent FREE-GRANT line (FREE_ITEM / BOGO): zero-price, quantity
            // 0 + freeQty — stock + COGS move (the margin engine counts free units
            // as real cost given away) but the bill math is untouched. POS parity.
            if ((l.freeQty ?? 0) > 0) {
                // The label falls back to the money-slot coupon (a rule-3
                // money-grant's line is stamped with its own coupon).
                computedLines.push({
                    productId: l.productId,
                    description: `FREE · ${t.order.freeCouponCode ?? t.order.couponCode ?? "Offer"}`,
                    quantity: 0,
                    rate: 0,
                    taxRate: 0,
                    discountAmt: 0,
                    taxAmount: 0,
                    amount: 0,
                    freeQty: l.freeQty ?? 0,
                    savedSalePricePaise: null,
                    mrpPaise: l.product?.mrpPaise ?? null,
                    product: l.product ? { stock: l.product.stock } : null,
                });
                continue;
            }
            const tax = await resolveProductTax(l.productId);
            const taxable = tax.taxability == null || tax.taxability === "TAXABLE";
            const r = taxable ? (tax.gstRate ?? 0) : 0;
            const inclUnit = l.unitPricePaise / 100;
            const rate = r > 0 ? inclUnit / (1 + r / 100) : inclUnit; // unrounded pre-engine
            const discountAmt = (l.tierDiscountPaise ?? 0) / 100;    // pre-tax, frozen at checkout
            const { taxAmount, amount } = calcLineTotals({
                quantity: l.quantity, rate, discountPct: 0, discountAmt, taxRate: r,
            });
            computedLines.push({
                productId: l.productId,
                description: l.product?.name ?? `Product #${l.productId}`,
                quantity: l.quantity,
                rate,
                taxRate: r,
                discountAmt,
                taxAmount,
                amount,
                freeQty: 0,
                // Ladder snapshots (paise) — the storefront tag + MRP, so the
                // printed receipt can show the same price-benefit rows as POS.
                savedSalePricePaise: l.unitPricePaise,
                mrpPaise: l.product?.mrpPaise ?? null,
                product: l.product ? { stock: l.product.stock } : null,
            });
        }

        // 3. Shipping GST (composite supply). Weights = pre-tax, pre-discount
        // line values — the same basis the POS uses.
        const shipping = (t.order.shippingChargePaise ?? 0) / 100;
        const shippingGstRate = shipping > 0
            ? resolveShippingGstRate(computedLines.map((l) => ({ value: l.quantity * l.rate, taxRate: l.taxRate })))
            : 0;
        const shippingTaxAmt = (shipping * shippingGstRate) / (100 + shippingGstRate);

        // The checkout-frozen coupon replays as a NEGATIVE charge row (Dr the
        // coupon expense ledger — same shape as the POS sale's coupon leg). The
        // on-top partial (rule 2) rides the SAME leg — its ₹ is never
        // guard-clamped, exactly as at checkout.
        const couponRupees = (t.order.couponDiscountPaise ?? 0) / 100;
        const onTopRupees = (t.order.onTopDiscountPaise ?? 0) / 100;
        const couponTotalRupees = couponRupees + onTopRupees;
        let couponCharge: { accountId: number; amount: number; description: string } | null = null;
        if (couponTotalRupees > 0.005) {
            const couponConfig = await prisma.couponConfig.findUnique({ where: { id: 1 } });
            if (couponConfig?.couponExpenseAccountId == null) {
                return NextResponse.json(
                    { error: "Coupon ledger is not configured. Re-run the bootstrap seed.", code: "COUPON_LEDGER_MISSING" },
                    { status: 422 },
                );
            }
            const onTopTag = onTopRupees > 0.005 && t.order.onTopCouponCode
                ? ` + ${t.order.onTopCouponCode} on top`
                : "";
            couponCharge = {
                accountId: couponConfig.couponExpenseAccountId,
                amount: -couponTotalRupees,
                description: `Coupon ${t.order.couponCode ?? ""}${onTopTag}`.trim(),
            };
        }

        // ── Loyalty (POS parity, run at posting time) ─────────────────────
        // The checkout froze the redemption CHOICE; this route burns the lots,
        // earns on the goods, and awards milestones — all inside the posting tx
        // via applyLoyaltyForSale/applyMilestones, exactly like /api/pos/sale.
        const loyaltyConfig = await prisma.loyaltyConfig.findUnique({ where: { id: 1 } });
        const loyaltyRates = loyaltyConfig ? ratesFromConfig(loyaltyConfig) : null;
        // Customer Quality: no-discount flag — a flagged customer earns nothing
        // at posting time (checkout already froze zero benefits for them). A
        // redemption frozen BEFORE the flag was set still burns below — the
        // order promised the customer that price; only new benefits stop.
        const flagAcct = await prisma.account.findUnique({
            where:  { id: t.accountId },
            select: { person: { select: { noDiscount: true } }, company: { select: { noDiscount: true } } },
        });
        const noDiscountFlag = (flagAcct?.person?.noDiscount ?? flagAcct?.company?.noDiscount) === true;
        const loyaltyEnabled = !!loyaltyRates?.enabled;
        const redeemPoints = loyaltyEnabled ? (t.order.loyaltyRedeemPoints ?? 0) : 0;
        const redeemRupees = loyaltyEnabled ? (t.order.loyaltyRedeemPaise ?? 0) / 100 : 0;
        let loyaltyCharge: { accountId: number; amount: number; description: string } | null = null;
        if (redeemRupees > 0.005) {
            if (loyaltyConfig?.redeemExpenseAccountId == null) {
                return NextResponse.json(
                    { error: "Loyalty redemption ledger is not configured. Re-run the bootstrap seed.", code: "LOYALTY_LEDGER_MISSING" },
                    { status: 422 },
                );
            }
            // The frozen points must still exist — they were only validated at
            // checkout, not burned. A drained balance means another sale spent
            // them; surface it instead of posting a mismatched discount.
            const balanceNow = await liveBalance(prisma, accountId, loyaltyRates!);
            if (balanceNow < redeemPoints) {
                return NextResponse.json(
                    { error: `The customer's loyalty balance (${balanceNow} pts) no longer covers the ${redeemPoints} pts frozen on this order. Adjust the order before invoicing.`, code: "LOYALTY_POINTS_GONE" },
                    { status: 422 },
                );
            }
            loyaltyCharge = {
                accountId: loyaltyConfig.redeemExpenseAccountId,
                amount: -redeemRupees,
                description: `Loyalty: ${redeemPoints} pts redeemed`,
            };
        }

        const extraCharges = [
            ...(couponCharge ? [couponCharge] : []),
            ...(loyaltyCharge ? [loyaltyCharge] : []),
        ];
        const chargesNet = extraCharges.reduce((s, c) => s + c.amount, 0);

        // POS-style totals: lines are NET of the tier discount; subtotal is
        // stored GROSS of it so the engine posts the Discount Allowed leg.
        const tierPretaxDiscount = round2(computedLines.reduce((s, l) => s + l.discountAmt, 0));
        const netTotals = calcVoucherTotals(computedLines, shipping, 0, 0, chargesNet);
        const subtotal = round2(netTotals.subtotal + tierPretaxDiscount);
        const taxAmount = netTotals.taxAmount;
        // The customer already PAID the order's frozen paise total — snap any
        // float-recompute crumb (≤5p) onto the Round Off leg so the invoice
        // total equals the paid amount exactly and the AR nets to zero.
        const paidTotal = ((t.order.totalPaise ?? 0) + (t.order.shippingChargePaise ?? 0)) / 100;
        const crumb = round2(paidTotal - netTotals.totalAmount);
        const roundOff = Math.abs(crumb) <= 0.05 ? crumb : 0;
        const totalAmount = calcVoucherTotals(computedLines, shipping, 0, roundOff, chargesNet).totalAmount;

        const addr = (t.order.shippingAddress ?? {}) as Record<string, unknown>;
        const partyName = t.order.shippingName || t.account?.name || "Customer";
        const partyType = t.account?.personId ? "customer" : t.account?.companyId ? "company" : null;
        const partyId = t.account?.personId ?? t.account?.companyId ?? null;
        const partyAddress = [addr.line1, addr.line2, addr.city, addr.state, addr.pincode]
            .filter((x) => typeof x === "string" && x.trim())
            .join(", ");
        const placeOfSupply = stateCodeForName(typeof addr.state === "string" ? addr.state : null) ?? null;

        // Seller = the online channel's branch (Head Office), falling back to the
        // org. `systemBranchId` owns the "which branch does a no-counter write
        // belong to" rule, so the id is not spelled out again here.
        const hqBranchId = await systemBranchId(prisma);
        const [hqBranch, org] = await Promise.all([
            prisma.branch.findUnique({ where: { id: hqBranchId }, select: { gstStateCode: true } }),
            getOrganisation(),
        ]);
        const sellerStateCode = (hqBranch?.gstStateCode || org.gstStateCode || "").trim() || null;
        const buyerStateCode = placeOfSupply ?? sellerStateCode;

        // ── Loyalty earn context (reads, outside the tx — POS parity) ──────
        // earnLines carry the PRE-TAX, pre-discount goods value per line; the
        // rules index + parent chains drive per-line earn multipliers.
        let earnLines: EarnLine[] = [];
        let rulesIndex = buildRulesIndex([]);
        let taxonomyMaps: TaxonomyMaps = { groupParent: new Map(), categoryParent: new Map() };
        let milestoneTiers: MilestoneTier[] = [];
        if (loyaltyEnabled) {
            const [groups, categories, rules, milestones] = await Promise.all([
                prisma.invProductGroup.findMany({ select: { id: true, parentId: true } }),
                prisma.invCategory.findMany({ select: { id: true, parentId: true } }),
                prisma.loyaltyEarnRule.findMany({ where: { enabled: true }, select: { scope: true, categoryId: true, groupId: true, productId: true, multiplier: true, redeemCapPct: true, enabled: true } }),
                prisma.loyaltyMilestone.findMany({ where: { enabled: true }, orderBy: { threshold: "asc" } }),
            ]);
            // Flagged → no earn lines (earn = 0) while the frozen redemption,
            // if any, still burns via applyLoyaltyForSale below. Discount-protected
            // lines are dropped too (POS parity — protected products neither earn
            // nor redeem). Map first (keeps the computedLines index), then filter.
            const protectedProductIds = await loadProtectedProductIds(prisma);
            earnLines = noDiscountFlag ? [] : t.order.lines
                .map((l, i) => ({
                    productId: l.productId,
                    groupId: l.product?.groupId ?? null,
                    categoryId: l.product?.categoryId ?? null,
                    goods: computedLines[i].quantity * computedLines[i].rate,
                }))
                .filter((line) => !protectedProductIds.has(line.productId));
            rulesIndex = buildRulesIndex(rules.map((r) => ({ ...r, multiplier: Number(r.multiplier), redeemCapPct: r.redeemCapPct == null ? null : Number(r.redeemCapPct) })));
            taxonomyMaps = {
                groupParent: new Map(groups.map((g) => [g.id, g.parentId])),
                categoryParent: new Map(categories.map((c) => [c.id, c.parentId])),
            };
            // Flagged → no milestone awards either (bonus points are a benefit).
            milestoneTiers = noDiscountFlag ? [] : milestones.map((m) => ({ id: m.id, threshold: Number(m.threshold), bonusPoints: m.bonusPoints, label: m.label, issuesCouponTemplateId: m.issuesCouponTemplateId }));
        }

        const receiptVoucherId = Number(addr.receiptVoucherId) || null;
        const voucherDate = requestBusinessDate(req);
        const description = `Online sale — Order #${oid}`;

        let allocated = false;
        const result = await prisma.$transaction(async (tx) => {
            // ── Spine FIRST (document anchor), then the 1:1 detail + lines ──
            const voucherRef = await invNextRef(tx, "ONLINE_INVOICE");
            const spineId = await engineCreateSpine(tx, {
                type:           "ONLINE_INVOICE",
                date:           voucherDate,
                description,
                voucherNo:      voucherRef,
                partyAccountId: accountId,
                branchId:       hqBranchId,
                userId:         user!.id,
            });
            const partyJson = buildPartyJson({
                name:    partyName,
                phone:   typeof addr.phone === "string" ? addr.phone : null,
                address: partyAddress || null,
            });
            const voucher = await tx.voucherDetail.create({
                data: {
                    universalVoucherId: spineId,
                    partyJson:      partyJson ?? Prisma.DbNull,
                    partyType,
                    partyId,
                    deliveryMode:   "SHIPPED",
                    placeOfSupply,
                    shippingAmt:    shipping,
                    shippingTaxAmt: round2(shippingTaxAmt),
                    // Frozen tier discount — gross subtotal + this posts the
                    // Discount Allowed leg (POS parity).
                    discountAmt:    tierPretaxDiscount,
                    discountPct:    t.order!.tierDiscountPct != null ? Number(t.order!.tierDiscountPct) : null,
                    roundOff,
                    subtotal,
                    taxAmount,
                    totalAmount,
                    // CREDIT sale: the whole total is the customer-AR tender; the
                    // advance receipt (online payment) allocates against it below.
                    // Coupon + loyalty ride as negative charge rows (G4b shape).
                    settlementJson: buildSettlementJson(
                        [{ accountId, amount: totalAmount, method: null, reference: null }],
                        extraCharges,
                    ),
                },
            });
            await tx.voucherInventoryLine.createMany({
                data: computedLines.map((l) => ({
                    universalVoucherId: spineId,
                    productId:   l.productId,
                    description: l.description,
                    quantity:    l.quantity,
                    rate:        l.rate,
                    taxRate:     l.taxRate,
                    discountAmt: l.discountAmt,
                    discountPct: t.order!.tierDiscountPct != null ? Number(t.order!.tierDiscountPct) : 0,
                    taxAmount:   l.taxAmount,
                    amount:      l.amount,
                    freeQty:     l.freeQty,
                    mrpPaise:            l.mrpPaise,
                    savedSalePricePaise: l.savedSalePricePaise,
                })),
            });

            // ── GL + stock OUT in one enginePost (ONLINE_INVOICE is a fixed-
            // direction OUT type in buildTradingStockMoves) ──────────────────
            const spec = await saleToSpec(
                tx,
                {
                    id:          voucher.id,
                    type:        "ONLINE_INVOICE",
                    reference:   voucherRef,
                    date:        voucherDate,
                    description,
                    partyJson:   voucher.partyJson,
                    subtotal:    voucher.subtotal,
                    taxAmount:   voucher.taxAmount,
                    shippingAmt: voucher.shippingAmt,
                    // UNROUNDED (matches line tax) — engine rounds each leg once.
                    shippingTaxAmt,
                    discountAmt: voucher.discountAmt,
                    roundOff:    voucher.roundOff,
                    totalAmount: voucher.totalAmount,
                    tenders:     [{ accountId, amount: totalAmount, method: null, reference: null }],
                    charges:     extraCharges,
                    sellerStateCode,
                    buyerStateCode,
                },
                { branchId: hqBranchId, lines: computedLines },
            );
            const gl = await enginePost(tx, spec, user!.id, { branchId: hqBranchId, existingSpineId: spineId });
            if (gl.journalEntryId === null) {
                throw new GlPostFailedError(
                    `Cannot post ONLINE_INVOICE ${voucherRef}: engine produced no journal entry.`,
                );
            }

            // ── Reservation → EXECUTED, link invoice ↔ order, allocate receipt ──
            const held = await tx.stockReservation.findMany({
                where: { orderSource: "shop", orderId: oid, status: "HELD" },
                select: { productId: true, quantity: true },
            });
            for (const r of held) {
                await tx.invProduct.update({
                    where: { id: r.productId },
                    data: { reserved: { decrement: r.quantity } },
                });
            }
            if (held.length > 0) {
                await tx.stockReservation.updateMany({
                    where: { orderSource: "shop", orderId: oid, status: "HELD" },
                    data: { status: "EXECUTED" },
                });
            }

            await syncVoucherLinks(tx, spineId, { shopOrderId: oid });

            // Stamp the checkout-taken coupon redemption with this invoice's
            // spine, so full-return reversal (which matches on the voucher)
            // frees the usage slot exactly as it does for a POS sale.
            if (t.order!.couponRedemptionId != null) {
                await tx.couponRedemption.updateMany({
                    where: { id: t.order!.couponRedemptionId, universalVoucherId: null },
                    data: { universalVoucherId: spineId },
                });
            }
            // Same for the free-grant coupon's usage slot (amount 0 — the row
            // still enforces caps; reversal frees it on a full return).
            if (t.order!.freeCouponRedemptionId != null) {
                await tx.couponRedemption.updateMany({
                    where: { id: t.order!.freeCouponRedemptionId, universalVoucherId: null },
                    data: { universalVoucherId: spineId },
                });
            }
            // And the on-top partial's slot (amount = its ₹).
            if (t.order!.onTopRedemptionId != null) {
                await tx.couponRedemption.updateMany({
                    where: { id: t.order!.onTopRedemptionId, universalVoucherId: null },
                    data: { universalVoucherId: spineId },
                });
            }

            // ── Loyalty: burn the frozen redemption + earn on the goods + any
            // lifetime-spend milestones — one applyLoyaltyForSale, POS parity.
            // combinedDiscount reduces the earn base by everything the customer
            // saved (tier incl-effect + coupon + redemption), like the counter.
            if (loyaltyEnabled && loyaltyRates) {
                await applyLoyaltyForSale(tx, {
                    accountId,
                    universalVoucherId: spineId,
                    earnLines,
                    combinedDiscount: ((t.order!.tierDiscountPaise ?? 0) / 100) + couponTotalRupees + redeemRupees,
                    redeemPoints,
                    // Pre-redemption bill value gates minEarnInvoiceValue — the
                    // paid total plus everything discounted off it.
                    invoiceValue: paidTotal + ((t.order!.tierDiscountPaise ?? 0) / 100) + couponTotalRupees + redeemRupees,
                    rates: loyaltyRates,
                    rulesIndex,
                    taxonomyMaps,
                    createdById: user!.id,
                });
                if (milestoneTiers.length > 0) {
                    // Lifetime spend aggregated inside the tx so it includes the
                    // just-posted invoice; every sale channel counts.
                    const spendAgg = await tx.voucherDetail.aggregate({
                        where: { universalVoucher: { partyAccountId: accountId, status: "POSTED", deletedAt: null, type: { in: [...TIER_SPEND_VOUCHER_TYPES] } } },
                        _sum: { totalAmount: true },
                    });
                    await applyMilestones(tx, {
                        accountId,
                        lifetimeSpend: Number(spendAgg._sum.totalAmount ?? 0),
                        universalVoucherId: spineId,
                        milestones: milestoneTiers,
                        rates: loyaltyRates,
                        createdById: user!.id,
                    });
                }
            }

            // Allocate the order's advance receipt onto this invoice, unless the
            // receipt is already allocated to a live target (re-raise safety).
            if (receiptVoucherId) {
                const priorAllocs = await tx.voucherAllocation.findMany({
                    where: { sourceType: "VOUCHER", sourceId: receiptVoucherId, targetType: "UNIVERSAL_VOUCHER" },
                    select: { targetId: true },
                });
                const liveTarget = priorAllocs.length
                    ? await tx.universalVoucher.findFirst({
                          where: { id: { in: priorAllocs.map((a) => a.targetId) }, status: { not: "CANCELLED" }, deletedAt: null },
                          select: { id: true },
                      })
                    : null;
                if (!liveTarget) {
                    // `receiptVoucherId` IS the advance receipt's spine id — onlineReceipt.ts
                    // stamps what engineCreateVoucher returned, and the prior-allocation read
                    // above and the create below both treat it as one. A RECEIPT is spine-only
                    // (no VoucherDetail sidecar; that table is the inventory document), so its
                    // total comes from the DEBIT GL legs. Guarded on kind/status so a stale id
                    // cannot allocate some unrelated voucher's money onto this invoice.
                    const receipt = await tx.universalVoucher.findFirst({
                        where: { id: receiptVoucherId, type: "RECEIPT", status: "POSTED", deletedAt: null },
                        select: { voucherNo: true },
                    });
                    if (receipt) {
                        const amount = Math.min(await voucherDebitTotal(tx, receiptVoucherId), totalAmount);
                        if (amount > 0.005) {
                            await tx.voucherAllocation.create({
                                data: {
                                    targetType: "UNIVERSAL_VOUCHER",
                                    targetId: spineId,
                                    sourceType: "VOUCHER",
                                    sourceId: receiptVoucherId,
                                    amount,
                                    method: "AGAINST_REF",
                                    reference: receipt.voucherNo ?? `RCPT-${receiptVoucherId}`,
                                    createdById: user!.id,
                                },
                            });
                            allocated = true;
                        }
                    }
                }
            }

            return { invoiceId: voucher.id, reference: voucherRef };
        }, { timeout: 30_000, maxWait: 10_000 });

        // After-commit pricing recompute (mirrors the /post route). Failure must
        // NOT roll back the invoice — log and continue.
        await recomputePricesForProducts(computedLines.map((l) => l.productId)).catch((err: unknown) => {
            console.error("[price-recompute] failed for online invoice of order", oid, err);
        });

        return NextResponse.json({ ...result, allocated });
    } catch (e) {
        if (e instanceof GlPostFailedError) {
            return NextResponse.json({ error: e.message }, { status: 422 });
        }
        return handleApiError(e, "Failed to create the invoice");
    }
}
