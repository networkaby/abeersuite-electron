import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { resolveTierForAccount } from "@/shared/lib/pricing";
import { resolveEffectiveCostMap } from "@/modules/pricing-strategy/lib/resolveCost";
import { resolveProductTax } from "@/modules/inventory/lib/gstResolver";
import {
    selectCouponForCart,
    selectAutoOnTopCoupon,
    finalizeCouponAmount,
    couponExclusionMask,
    type CartLineLite,
    type EvalInput,
    type CouponSelection,
    type CouponContext,
} from "@/modules/coupons/lib";
import {
    ratesFromConfig,
    liveBalance,
    buildRulesIndex,
    redeemableBaseForCart,
    clampRedemption,
    type EarnLine,
    type TaxonomyMaps,
} from "@/modules/loyalty/lib";
import { loadProtectedProductIds } from "@/modules/retention/lib/protection";

// Customer benefits for the ONLINE shop — the POS counter engines applied to
// storefront lines. ONE implementation shared by:
//   • /api/shop/orders        — the authoritative, frozen-at-checkout numbers
//   • /api/shop/tier-preview  — the same numbers shown early on cart/checkout
//
// Three benefits, finalized together exactly like /api/pos/sale:
//   • Spend-tier ("level") discount — tier% × cost-excl × qty per line,
//     PRE-TAX, clamped to the line's pre-tax value; storefront tags are
//     tax-INCLUSIVE so pre-tax values are backed out per product GST rate.
//   • Loyalty redemption — requested points clamped by balance, the floors,
//     and the cart-aware redeem ceiling (per-line redeem-cap %, POS's
//     clampRedemption). Points are only VALIDATED here — the invoice
//     conversion burns the lots when it posts.
//   • Coupon — explicit code or the best AUTO offer (channel SHOP), valued by
//     the shared selectCouponForCart, then finalizeCouponAmount runs the POS
//     stacking rules: a non-stackable coupon DROPS the tier and cannot combine
//     with loyalty points (explicit code → hard error, like the POS counter;
//     an AUTO offer is skipped silently — the customer chose their points).
//   • Free grant — an independent FREE_ITEM / BOGO coupon (typed code or the
//     best AUTO free-grant) rides ON TOP of the money coupon as a zero-price
//     order line (freeQty), exactly like the POS counter's FREE row.

type Db = PrismaClient | Prisma.TransactionClient;

export type ShopTierLine = { productId: number; quantity: number; unitPricePaise: number };

export type ShopCartBenefits = {
    /** Stacked tier % (capped by the global guard). 0 = no discount. */
    tierPct: number;
    /** Badge level name for the bill row ("Gold"); null when no title. */
    tierLabel: string | null;
    /** Σ inclusive tier effect in paise AFTER the coupon interplay
     *  (0 when a non-stackable coupon dropped the tier). */
    discountInclPaise: number;
    /** Per-line PRE-TAX tier discount paise (post-interplay), by line index. */
    lineDiscPaise: Map<number, number>;
    /** The applied coupon (explicit code or best AUTO offer); null = none. */
    coupon: {
        id: number;
        /** Coupon code — null on a codeless AUTO offer (fall back to `name`). */
        code: string | null;
        name: string;
        /** Customer-facing ₹ cut in paise — rides as a negative charge row. */
        discountPaise: number;
        stackable: boolean;
        droppedTier: boolean;
        clampedByGuard: boolean;
    } | null;
    /** Independent FREE-GRANT coupon (FREE_ITEM / BOGO) applying ON TOP of the
     *  money coupon — the granted item rides the order as a zero-price line
     *  (freeQty), exactly like the POS counter. null = none. */
    freeGrant: {
        couponId: number;
        /** Coupon code — null on a codeless AUTO offer (fall back to `name`). */
        code: string | null;
        name: string;
        productId: number;
        productName: string;
        freeQty: number;
    } | null;
    /** Rule 2 — an independent PARTIAL (<100%) FREE_ITEM / BOGO coupon riding
     *  ON TOP of the money coupon: a ₹ discount (never guard-clamped, never
     *  drops tier / blocks loyalty). null = none. */
    onTop: {
        couponId: number;
        /** Coupon code — null on a codeless AUTO offer (fall back to `name`). */
        code: string | null;
        name: string;
        discountPaise: number;
    } | null;
    /** Rule 3 — a NON-independent fully-free FREE_ITEM / BOGO coupon that WON
     *  the money slot: its item rides the order as a zero-price line too, but
     *  with money-slot semantics (exclusivity mask applies). null = none. */
    moneyGrant: {
        couponId: number;
        /** Coupon code — null on a codeless AUTO offer (fall back to `name`). */
        code: string | null;
        name: string;
        productId: number;
        productName: string;
        freeQty: number;
    } | null;
    /** Rejection reason when an EXPLICIT code failed (auto-apply fails silently). */
    couponError: string | null;
    /** Loyalty context + the validated redemption (null when the programme or
     *  its redeem gate is off). Points burn at invoice post, not here. */
    loyalty: {
        balance: number;
        /** ₹ value of one point (redeemValue) — the UI's live maths. */
        redeemValue: number;
        minRedeemPoints: number;
        /** Most points this cart can absorb right now (balance ∧ ceiling). */
        maxRedeemablePts: number;
        /** Validated/clamped redemption for the REQUESTED points. */
        redeemPoints: number;
        redeemPaise: number;
        /** Rejection reason when points were requested but none applied. */
        redeemError: string | null;
    } | null;
};

/**
 * `currentSaleValuePaise` = the bill BEFORE any discount (goods incl +
 * shipping when known — pass goods-only from the cart preview, where the
 * courier isn't chosen yet). Mirrors resolveTierTitles' contract.
 */
export async function computeShopCartBenefits(
    db: Db,
    accountId: number,
    lines: ShopTierLine[],
    currentSaleValuePaise: number,
    opts: { couponCode?: string | null; autoApply?: boolean; redeemPoints?: number } = {},
): Promise<ShopCartBenefits> {
    // Customer Quality: no-discount flag — flagged customer bills at barcode
    // price on the shop too. Every benefit comes back empty (tier 0, no coupon,
    // no loyalty), so both the preview and the frozen order numbers are zeros.
    // Silent: the storefront just shows a plain full-price cart; an explicitly
    // typed coupon code gets the generic not-applicable line.
    const flagAcct = await db.account.findUnique({
        where:  { id: accountId },
        select: { person: { select: { noDiscount: true } }, company: { select: { noDiscount: true } } },
    });
    if ((flagAcct?.person?.noDiscount ?? flagAcct?.company?.noDiscount) === true) {
        return {
            tierPct: 0, tierLabel: null, discountInclPaise: 0, lineDiscPaise: new Map(),
            coupon: null, freeGrant: null, onTop: null, moneyGrant: null,
            couponError: opts.couponCode?.trim() ? "This coupon isn't applicable on this order." : null,
            loyalty: null,
        };
    }

    // A customer who has actually PURCHASED before (order reached PAID or
    // beyond) is not "new" — even while staff hasn't invoiced it yet. Without
    // this, a NEW-scoped welcome period re-fires on every order until the
    // first invoice posts (paid orders aren't ledger spend until then).
    // Deliberately EXCLUDES PENDING_PAYMENT/DRAFT/CANCELLED: an abandoned,
    // never-paid checkout must not cost a first-time buyer their welcome
    // offer. (A placed COD order sits PENDING_PAYMENT briefly — but its
    // invoice posts before packing, and posted invoices already count.)
    const priorOrders = await db.ticketOrder.count({
        where: {
            ticket: { accountId },
            legacyStatus: { in: ["PAID", "PACKED", "SHIPPED", "DELIVERED", "REFUNDED"] },
        },
    });
    const tierCtx = await resolveTierForAccount(db, accountId, currentSaleValuePaise / 100, {
        extraPriorSales: priorOrders,
    });
    const tierPct = tierCtx.tier.discountPct;
    const tierLabel = tierCtx.tier.badgeLevelName || null;

    if (lines.length === 0) {
        return {
            tierPct, tierLabel, discountInclPaise: 0, lineDiscPaise: new Map(),
            coupon: null, freeGrant: null, onTop: null, moneyGrant: null, couponError: null, loyalty: null,
        };
    }

    // Discount-protection blacklist (Retention → Protection) — protected lines are
    // excluded from the tier discount, coupon eligibility, and loyalty redemption.
    const protectedProductIds = await loadProtectedProductIds(db);

    // Per-product cost + GST rate — the tier base AND the coupon's cost-incl base.
    const productIds = [...new Set(lines.map((l) => l.productId))];
    const [costPaiseById, taxRatePairs] = await Promise.all([
        resolveEffectiveCostMap(productIds),
        Promise.all(productIds.map(async (pid): Promise<[number, number]> => {
            const tax = await resolveProductTax(pid);
            const taxable = tax.taxability == null || tax.taxability === "TAXABLE";
            return [pid, taxable ? (tax.gstRate ?? 0) : 0];
        })),
    ]);
    const taxRateById = new Map(taxRatePairs);
    // Pre-tax line value (₹) — backed out of the inclusive tag once, used by
    // the tier clamp, the coupon bases, and the loyalty earn lines alike.
    const lineTaxableRs = (l: ShopTierLine): number => {
        const rate = taxRateById.get(l.productId) ?? 0;
        return (l.unitPricePaise * l.quantity) / 100 / (1 + rate / 100);
    };

    // ── Tier, RAW (before coupon interplay) — POS formula per line ─────────
    const rawLineDisc = new Map<number, number>(); // index → pre-tax float paise
    let rawInclEffect = 0;                          // float paise
    if (tierPct > 0) {
        lines.forEach((l, i) => {
            if (protectedProductIds.has(l.productId)) return;
            const costExcl = costPaiseById.get(l.productId) ?? null;
            if (costExcl == null) return;
            const rate = taxRateById.get(l.productId) ?? 0;
            const lineTaxable = lineTaxableRs(l) * 100;
            const discExcl = Math.min((tierPct / 100) * costExcl * l.quantity, lineTaxable);
            if (discExcl <= 0) return;
            rawLineDisc.set(i, discExcl);
            rawInclEffect += discExcl * (1 + rate / 100);
        });
    }

    // Taxonomy — shared by the loyalty redeem ceiling AND coupon rules;
    // loaded once, only when either needs it.
    let taxonomy: Map<number, { groupId: number | null; categoryId: number | null; brandId: number | null }> | null = null;
    const loadTaxonomy = async () => {
        if (taxonomy) return taxonomy;
        taxonomy = new Map(
            (await db.invProduct.findMany({
                where: { id: { in: productIds } },
                select: { id: true, groupId: true, categoryId: true, brandId: true },
            })).map((p) => [p.id, p]),
        );
        return taxonomy;
    };

    // ── Coupon selection (moved ahead of the loyalty ceiling, mirrors POS) ──
    // Selected here, not finalized — LINE-scope exclusivity needs to know which
    // lines the coupon touches BEFORE the loyalty ceiling is computed.
    let coupon: ShopCartBenefits["coupon"] = null;
    let freeGrant: ShopCartBenefits["freeGrant"] = null;
    let onTop: ShopCartBenefits["onTop"] = null;
    let moneyGrant: ShopCartBenefits["moneyGrant"] = null;
    let couponError: string | null = null;
    let selected: CouponSelection = { kind: "none" };
    let couponConfig: { couponExpenseAccountId: number | null } | null = null;
    let couponLines: CartLineLite[] = [];
    let couponGoodsValue = 0;
    // The granted item + name for display — the order route freezes it as a
    // zero-price TicketOrderLine (freeQty), exactly like the POS counter.
    // Works for both grant flavours (rule 1 on-top and rule 3 money) — both
    // carry the same { coupon, grant } shape.
    const toGrant = async (sel: { coupon: CouponContext; grant: { productId: number; freeQty: number } }): Promise<NonNullable<ShopCartBenefits["freeGrant"]>> => {
        const p = await db.invProduct.findUnique({ where: { id: sel.grant.productId }, select: { name: true } });
        return {
            couponId: sel.coupon.id,
            code: sel.coupon.code,
            name: sel.coupon.name,
            productId: sel.grant.productId,
            productName: p?.name ?? "Item",
            freeQty: sel.grant.freeQty,
        };
    };
    const wantCoupon = !!(opts.couponCode?.trim() || opts.autoApply);
    if (wantCoupon) {
        couponConfig = await db.couponConfig.findUnique({ where: { id: 1 } });
        const noExpenseLedger = couponConfig?.couponExpenseAccountId == null;
        if (opts.couponCode?.trim() && noExpenseLedger) {
            // Without the expense ledger the invoice could not post the coupon
            // leg — refuse up front rather than freeze an unpostable discount.
            couponError = "Coupons are not configured yet.";
        } else {
            const tax = await loadTaxonomy();
            // POS bases: unitPrice + goodsValue are PRE-TAX (coupons discount
            // the SALE value, not cost — cost must never be derivable).
            couponLines = lines.map((l) => ({
                productId: l.productId,
                groupId: tax.get(l.productId)?.groupId ?? null,
                categoryId: tax.get(l.productId)?.categoryId ?? null,
                brandId: tax.get(l.productId)?.brandId ?? null,
                qty: l.quantity,
                unitPrice: lineTaxableRs(l) / l.quantity,
                // Discount-protected lines never match a coupon (see couponMath).
                protected: protectedProductIds.has(l.productId),
            }));
            couponGoodsValue = couponLines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
            const input: EvalInput = {
                accountId,
                lines: couponLines,
                goodsValue: couponGoodsValue,
                // Free-grant min-bill qualifies on the tax-inclusive bill (goods
                // + shipping here) — POS parity; money coupons keep the goods base.
                billAmountIncl: currentSaleValuePaise / 100,
                billBeforeCoupon: couponGoodsValue,
                isNewCustomer: tierCtx.isNewCustomer,
                now: new Date(),
            };
            if (!noExpenseLedger) {
                selected = await selectCouponForCart(db, {
                    code: opts.couponCode, autoApply: opts.autoApply, channel: "SHOP", input,
                });
                if (selected.kind === "error") couponError = selected.reason;
                // A typed independent FREE_ITEM / BOGO code isn't a money ₹ —
                // route it to the on-top slot: fully free → the grant (rule 1),
                // partial → the on-top ₹ (rule 2).
                else if (selected.kind === "free-grant") {
                    freeGrant = await toGrant(selected);
                    selected = { kind: "none" };
                } else if (selected.kind === "on-top") {
                    onTop = {
                        couponId: selected.coupon.id,
                        code: selected.coupon.code,
                        name: selected.coupon.name,
                        discountPaise: Math.round(selected.discountRupees * 100),
                    };
                    selected = { kind: "none" };
                } else if (selected.kind === "money-grant") {
                    // Rule 3 — kept as the MONEY winner (exclusivity applies);
                    // the grant is materialized after the tier interplay below.
                }
            }
            // On-top slot: a typed independent code won above; otherwise the
            // best eligible AUTO on-top offer fires on its own (POS parity). No
            // expense ledger needed for a grant — but a partial's ₹ does need it
            // (checked in the orders route, which freezes the charge).
            if (!freeGrant && !onTop) {
                const autoTop = await selectAutoOnTopCoupon(db, { channel: "SHOP", input, protectedProductIds });
                if (autoTop.kind === "free-grant") freeGrant = await toGrant(autoTop);
                else if (autoTop.kind === "on-top") {
                    onTop = {
                        couponId: autoTop.coupon.id,
                        code: autoTop.coupon.code,
                        name: autoTop.coupon.name,
                        discountPaise: Math.round(autoTop.discountRupees * 100),
                    };
                }
            }
        }
    }
    const moneyWinner = selected.kind === "ok" || selected.kind === "money-grant" ? selected : null;
    const exclusionMask: boolean[] = moneyWinner ? couponExclusionMask(moneyWinner.coupon, couponLines) : lines.map(() => false);
    const lineScopeExclusive = moneyWinner != null && !moneyWinner.coupon.stackable && moneyWinner.coupon.stackScope === "LINE";
    const billScopeExclusive = moneyWinner != null && !moneyWinner.coupon.stackable && moneyWinner.coupon.stackScope === "BILL";

    // ── Loyalty redemption (validate + clamp; burning happens at invoice) ──
    let loyalty: ShopCartBenefits["loyalty"] = null;
    const requestedPts = Math.max(0, Math.floor(opts.redeemPoints ?? 0));
    const loyaltyConfig = await db.loyaltyConfig.findUnique({ where: { id: 1 } });
    const rates = loyaltyConfig ? ratesFromConfig(loyaltyConfig) : null;
    if (rates?.enabled && rates.redeemEnabled) {
        const balance = await liveBalance(db, accountId, rates);
        // Cart-aware redeem ceiling — Σ (line goods − tier allocation) × the
        // item's redeem-cap % (product → group → category → global), exactly
        // as the POS computes it. Needs the earn-rule index + parent chains.
        // One after another: inside a transaction (one connection) pg 9 refuses parallel queries.
        const tax = await loadTaxonomy();
        const groups = await db.invProductGroup.findMany({ select: { id: true, parentId: true } });
        const categories = await db.invCategory.findMany({ select: { id: true, parentId: true } });
        const rules = await db.loyaltyEarnRule.findMany({ where: { enabled: true }, select: { scope: true, categoryId: true, groupId: true, productId: true, multiplier: true, redeemCapPct: true, enabled: true } });
        const earnLinesAll: EarnLine[] = lines.map((l) => ({
            productId: l.productId,
            groupId: tax.get(l.productId)?.groupId ?? null,
            categoryId: tax.get(l.productId)?.categoryId ?? null,
            goods: lineTaxableRs(l),
        }));
        // LINE-scope exclusivity drops the coupon's own matched lines out of the
        // ceiling base (they still can't earn/redeem on this bill); BILL scope
        // leaves the base untouched and the block below rejects/skips instead.
        // Discount-protected lines are dropped from the base in EVERY case (no
        // redemption against a protected product). earnLinesAll is index-aligned
        // with lines.
        const earnLines = earnLinesAll.filter((_, i) =>
            !protectedProductIds.has(lines[i].productId)
            && (!lineScopeExclusive || !exclusionMask[i]),
        );
        const rulesIndex = buildRulesIndex(rules.map((r) => ({ ...r, multiplier: Number(r.multiplier), redeemCapPct: r.redeemCapPct == null ? null : Number(r.redeemCapPct) })));
        const taxonomyMaps: TaxonomyMaps = {
            groupParent: new Map(groups.map((g) => [g.id, g.parentId])),
            categoryParent: new Map(categories.map((c) => [c.id, c.parentId])),
        };
        const ceiling = redeemableBaseForCart(earnLines, rawInclEffect / 100, rulesIndex, taxonomyMaps, rates.maxRedeemPctOfBill);
        const redemption = clampRedemption(requestedPts, balance, ceiling, currentSaleValuePaise / 100, rates);
        loyalty = {
            balance,
            redeemValue: rates.redeemValue,
            minRedeemPoints: rates.minRedeemPoints ?? 0,
            maxRedeemablePts: rates.redeemValue > 0 ? Math.min(balance, Math.floor(ceiling / rates.redeemValue)) : 0,
            redeemPoints: redemption.points,
            redeemPaise: Math.round(redemption.value * 100),
            redeemError: requestedPts > 0 && redemption.points === 0 ? (redemption.reason ?? null) : null,
        };
    }
    const redeemRupees = (loyalty?.redeemPaise ?? 0) / 100;

    // ── Coupon finalize + tier, EFFECTIVE (mask-dropped, not scaled) ───────
    const lineDiscPaise = new Map<number, number>();
    let inclEffect = 0;
    let droppedTier = false;
    const applyTierInFull = () => {
        for (const [i, discExcl] of rawLineDisc) {
            const rate = taxRateById.get(lines[i].productId) ?? 0;
            lineDiscPaise.set(i, Math.round(discExcl));
            inclEffect += discExcl * (1 + rate / 100);
        }
    };
    if (selected.kind === "ok" && couponConfig?.couponExpenseAccountId != null) {
        const redeeming = (loyalty?.redeemPoints ?? 0) > 0;
        if (billScopeExclusive && redeeming && opts.couponCode?.trim()) {
            // POS counter parity: an explicit non-stackable (whole-bill) code
            // cannot combine with points — surface the conflict, apply neither
            // (tier stays full, matching the pre-refactor `tierFactor` default).
            couponError = "This coupon can't be combined with loyalty points. Remove the points to use it.";
            applyTierInFull();
        } else if (billScopeExclusive && redeeming) {
            // Best AUTO offer vs chosen points → the customer's points win; the
            // offer is silently skipped. Tier still applies in full below.
            applyTierInFull();
        } else {
            for (const [i, discExcl] of rawLineDisc) {
                const scaled = exclusionMask[i] ? 0 : discExcl;
                if (scaled <= 0) continue;
                const rate = taxRateById.get(lines[i].productId) ?? 0;
                lineDiscPaise.set(i, Math.round(scaled));
                inclEffect += scaled * (1 + rate / 100);
            }
            droppedTier = inclEffect < rawInclEffect - 0.5;
            const fin = finalizeCouponAmount({
                selectedDiscount:    selected.discountRupees,
                tierRupees:          inclEffect / 100,
                loyaltyRupees:       redeemRupees,
                goodsValue:          couponGoodsValue,
                maxTotalDiscountPct: tierCtx.totalCapPct,
                maxCouponDiscountPct: tierCtx.couponCapPct,
            });
            if (fin.couponRupees > 0) {
                coupon = {
                    id: selected.coupon.id,
                    code: selected.coupon.code,
                    name: selected.coupon.name,
                    discountPaise: Math.round(fin.couponRupees * 100),
                    stackable: selected.coupon.stackable,
                    droppedTier,
                    clampedByGuard: fin.clampedByGuard,
                };
            }
        }
    } else if (selected.kind === "money-grant") {
        // Rule 3 — the money slot's fully-free winner: no ₹, but the
        // exclusivity interplay is real (a non-stackable grant still drops the
        // tier / blocks points). Grant materializes when it actually applies.
        const redeeming = (loyalty?.redeemPoints ?? 0) > 0;
        if (billScopeExclusive && redeeming && opts.couponCode?.trim()) {
            // Explicit code + points conflict — surface it, apply neither.
            couponError = "This coupon can't be combined with loyalty points. Remove the points to use it.";
            applyTierInFull();
        } else if (billScopeExclusive && redeeming) {
            // Best AUTO money-grant vs chosen points → points win; grant skipped.
            applyTierInFull();
        } else {
            for (const [i, discExcl] of rawLineDisc) {
                const scaled = exclusionMask[i] ? 0 : discExcl;
                if (scaled <= 0) continue;
                const rate = taxRateById.get(lines[i].productId) ?? 0;
                lineDiscPaise.set(i, Math.round(scaled));
                inclEffect += scaled * (1 + rate / 100);
            }
            droppedTier = inclEffect < rawInclEffect - 0.5;
            moneyGrant = await toGrant(selected);
        }
    } else {
        // No coupon applying (none selected, or none configured) — tier applies
        // in full, unaffected.
        applyTierInFull();
    }

    return {
        tierPct, tierLabel,
        discountInclPaise: Math.round(inclEffect),
        lineDiscPaise,
        coupon, freeGrant, onTop, moneyGrant, couponError,
        loyalty,
    };
}
