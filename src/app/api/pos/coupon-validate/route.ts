import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { loadPartyPricing } from "@/modules/pricing-strategy/lib/groupPricingServer";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { selectCouponForCart, selectCouponForCartById, selectOnTopCouponByCode, selectAutoOnTopCoupon, finalizeCouponAmount, eligibleCostBase, eligibleSubtotal, type EvalInput, type CouponSelection } from "@/modules/coupons/lib";
import { round2 } from "@/shared/lib/format";
import { resolveEffectiveCostMap } from "@/modules/pricing-strategy/lib/resolveCost";
import { loadProtectedProductIds } from "@/modules/retention/lib/protection";
import { floorExclFromPaise, floorRoomIncl } from "@/modules/pricing-strategy/lib/priceFloor";

// POST /api/pos/coupon-validate — validate a coupon code (or pick the best auto
// coupon) against the current cart. Returns the SAME ₹ the sale route will post,
// plus the stacking effect, so the POS total matches the server total exactly.

const lineSchema = z.object({
    productId:  z.number().int(),
    groupId:    z.number().int().nullable().optional(),
    categoryId: z.number().int().nullable().optional(),
    qty:        z.number().min(0),
    unitPrice:  z.number().min(0),
    // Line's snapshotted GST % — used to gross up the server-resolved cost to
    // cost-incl-tax for the LINE-scope tier-share estimate (the tier discount
    // is still % of cost). Same snapshot /sale receives.
    taxRate:    z.number().min(0).max(100).optional(),
    // Same safety-wall flag /sale receives (priceFloor.ts).
    applyFloor: z.boolean().optional(),
});

const bodySchema = z.object({
    accountId:     z.number().int().nullable().optional(),
    code:          z.string().trim().max(40).optional(),
    /// Force-apply a specific coupon by id (AUTO coupons have no code — the
    /// POS "Apply" button on an AUTO offer card uses this). Routes money
    /// coupons to the ₹ slot and free-grant coupons to the free slot.
    couponId:      z.number().int().optional(),
    /// Dedicated free-grant slot: an independent FREE_ITEM / BOGO coupon code.
    /// Resolved alone (it never competes with the money coupon) and returns the
    /// free lines to add to the bill at zero price.
    freeCode:      z.string().trim().max(40).optional(),
    /// Auto free-grant slot: pick the best eligible AUTO free-grant coupon (no
    /// code) for the cart — same response shape as freeCode.
    freeAutoApply: z.boolean().optional(),
    /// Tax-inclusive voucher bill amount (all +/− adjustments folded in) — the
    /// free-grant min-bill qualifier. Absent = falls back to goods.
    billAmountIncl: z.number().min(0).optional(),
    autoApply:     z.boolean().optional(),
    isNewCustomer: z.boolean().optional(),
    tierRupees:    z.number().min(0).optional(),
    loyaltyRupees: z.number().min(0).optional(),
    lines:         z.array(lineSchema).default([]),
});

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.POS_SHIFT_OPEN);
    if (response) return response;

    const { data, error } = await validateRequest(req, bodySchema);
    if (error) return error;

    try {
        // No coupons for this party — its no-discount flag (Customer Quality) or
        // its customer group's Coupons tick is off. Same generic wording as an
        // ineligible coupon, so nothing is revealed.
        if (data.accountId != null && !(await loadPartyPricing(prisma, data.accountId)).benefits.coupons) {
            return NextResponse.json({ ok: false, reason: data.code ? "No coupon applied" : "No automatic offer available" });
        }

        const goodsValue = data.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
        const tierRupees = data.tierRupees ?? 0;
        const loyaltyRupees = data.loyaltyRupees ?? 0;

        // Resolve each line's taxonomy + effective cost server-side (the POS client
        // doesn't send them) so include/exclude rules evaluate IDENTICALLY here and
        // in /sale (cost rides along for the LINE-scope tier-share estimate below).
        const productIds = [...new Set(data.lines.map((l) => l.productId))];
        const [products, costPaiseById, protectedProductIds] = await Promise.all([
            prisma.invProduct.findMany({ where: { id: { in: productIds } }, select: { id: true, groupId: true, categoryId: true, brandId: true, effectiveSalePricePaise: true } }),
            resolveEffectiveCostMap(productIds),
            loadProtectedProductIds(prisma),
        ]);
        const taxById = new Map(products.map((p) => [p.id, p]));
        // Safety wall — same floors /sale reads (priceFloor.ts).
        const floorLines = data.lines.map((l) => ({
            qty: l.qty, unitPrice: l.unitPrice, taxRate: l.taxRate ?? 0,
            floorExcl: l.applyFloor ? floorExclFromPaise(taxById.get(l.productId)?.effectiveSalePricePaise, l.taxRate ?? 0) : null,
        }));
        const floorRoom = floorLines.some((l) => l.floorExcl != null) ? floorRoomIncl(floorLines) : undefined;

        const input: EvalInput = {
            accountId: data.accountId ?? null,
            lines: data.lines.map((l) => {
                const costPaise = costPaiseById.get(l.productId) ?? null;
                return {
                    productId: l.productId,
                    groupId: taxById.get(l.productId)?.groupId ?? null,
                    categoryId: taxById.get(l.productId)?.categoryId ?? null,
                    brandId: taxById.get(l.productId)?.brandId ?? null,
                    qty: l.qty, unitPrice: l.unitPrice,
                    // Cost incl. tax — the LINE-scope tier-share estimate base
                    // (the tier discount is still % of cost, not the coupon).
                    costIncl: costPaise == null ? null : (costPaise / 100) * (1 + (l.taxRate ?? 0) / 100),
                    // Discount-protected lines never match a coupon (see couponMath).
                    protected: protectedProductIds.has(l.productId),
                };
            }),
            goodsValue,
            // Free-grant min-bill qualifies on the tax-inclusive voucher total
            // (goods + tax + shipping + charges − tier + round-off) when provided.
            billAmountIncl: data.billAmountIncl,
            // Coupon-alone ceiling; finalizeCouponAmount applies the stacking-aware ceiling.
            billBeforeCoupon: goodsValue,
            isNewCustomer: data.isNewCustomer ?? false,
            now: new Date(),
        };

        // ── Selection: the dedicated on-top slot (independent FREE_ITEM / BOGO),
        // or the money coupon ──
        // A typed code that turns out to be an independent FREE_ITEM / BOGO
        // coupon is routed to the on-top slot here too, so one code in either
        // box lands in the right place. The on-top slot returns a free-grant
        // (rule 1) or an on-top ₹ (rule 2); the money slot returns a ₹ discount
        // (rule 4) or a money-grant (rule 3).
        let selected: CouponSelection = { kind: "none" };
        let freeSelected: Extract<CouponSelection, { kind: "free-grant" }> | null = null;
        let onTopSelected: Extract<CouponSelection, { kind: "on-top" }> | null = null;
        if (data.freeCode) {
            const sel = await selectOnTopCouponByCode(prisma, { code: data.freeCode, channel: "POS", input, protectedProductIds });
            if (sel.kind === "error") return NextResponse.json({ ok: false, reason: sel.reason });
            if (sel.kind === "free-grant") freeSelected = sel;
            else onTopSelected = sel;
        } else if (data.freeAutoApply) {
            const sel = await selectAutoOnTopCoupon(prisma, { channel: "POS", input, protectedProductIds });
            if (sel.kind === "error") return NextResponse.json({ ok: false, reason: sel.reason });
            if (sel.kind === "free-grant") freeSelected = sel;
            else if (sel.kind === "on-top") onTopSelected = sel;
        } else if (data.couponId != null) {
            // Force-apply a specific coupon by id (AUTO — no code). An
            // independent coupon id is routed to the on-top slot automatically.
            selected = await selectCouponForCartById(prisma, { couponId: data.couponId, channel: "POS", input, protectedProductIds });
            if (selected.kind === "free-grant") {
                freeSelected = selected;
                selected = { kind: "none" };
            } else if (selected.kind === "on-top") {
                onTopSelected = selected;
                selected = { kind: "none" };
            } else if (selected.kind === "error") {
                return NextResponse.json({ ok: false, reason: selected.reason });
            }
        } else {
            selected = await selectCouponForCart(prisma, { code: data.code, autoApply: data.autoApply, channel: "POS", input, protectedProductIds });
            if (selected.kind === "free-grant") {
                freeSelected = selected;
            } else if (selected.kind === "on-top") {
                onTopSelected = selected;
            } else if (selected.kind === "none") {
                return NextResponse.json({ ok: false, reason: data.code ? "No coupon applied" : "No automatic offer available" });
            } else if (selected.kind === "error") {
                return NextResponse.json({ ok: false, reason: selected.reason });
            }
        }

        // Rule 1 — free-grant response: the items to add as zero-price FREE
        // lines. No ₹, no tier/loyalty interplay — the grant rides on top of
        // everything.
        if (freeSelected) {
            const names = await prisma.invProduct.findMany({
                where: { id: { in: [freeSelected.grant.productId] } },
                select: { id: true, name: true },
            });
            const nameById = new Map(names.map((p) => [p.id, p.name]));
            return NextResponse.json({
                ok: true,
                couponId: freeSelected.coupon.id,
                code: freeSelected.coupon.code,
                name: freeSelected.coupon.name,
                freeLines: [{
                    productId: freeSelected.grant.productId,
                    freeQty:   freeSelected.grant.freeQty,
                    productName: nameById.get(freeSelected.grant.productId) ?? "Item",
                }],
            });
        }

        // Rule 2 — on-top partial response: a ₹ discount ON TOP of the money
        // coupon (never clears it, never drops tier / blocks loyalty / hits the
        // guard). The client keeps the money coupon and shows this as a
        // separate on-top row.
        if (onTopSelected) {
            return NextResponse.json({
                ok: true,
                onTop: true,
                couponId: onTopSelected.coupon.id,
                code: onTopSelected.coupon.code,
                name: onTopSelected.coupon.name,
                discountRupees: onTopSelected.discountRupees,
            });
        }

        // Rule 3 — a non-independent fully-free FREE_ITEM / BOGO won the money
        // slot: respond with the free lines (money-grant), so the POS shows
        // FREE rows while the checkout payload still rides the money slot
        // (exclusivity applies).
        if (selected.kind === "money-grant") {
            const names = await prisma.invProduct.findMany({
                where: { id: { in: [selected.grant.productId] } },
                select: { id: true, name: true },
            });
            const nameById = new Map(names.map((p) => [p.id, p.name]));
            return NextResponse.json({
                ok: true,
                moneyGrant: true,
                couponId: selected.coupon.id,
                code: selected.coupon.code,
                name: selected.coupon.name,
                discountRupees: 0,
                freeLines: [{
                    productId: selected.grant.productId,
                    freeQty:   selected.grant.freeQty,
                    productName: nameById.get(selected.grant.productId) ?? "Item",
                }],
            });
        }

        // The on-top / money-grant paths returned above — the money ₹ coupon
        // won, so the selection is narrowed to a ₹ discount here.
        if (selected.kind !== "ok") {
            return NextResponse.json({ ok: false, reason: "No coupon applied" });
        }

        // ── Resolve product names for BOGO / FREE_ITEM cashier hints ──────────
        const couponProductIds = [
            selected.coupon.freeProductId,
            selected.coupon.buyProductId,
        ].filter((id): id is number => id != null);
        const couponProductNames = new Map(
            (await prisma.invProduct.findMany({
                where: { id: { in: couponProductIds } },
                select: { id: true, name: true },
            })).map((p) => [p.id, p.name]),
        );

        // This endpoint only receives BILL-wide tierRupees/loyaltyRupees from the
        // client (no per-line breakdown), unlike /sale which computes them line by
        // line. For a LINE-scope coupon we estimate the exclusion by the coupon's
        // matched-line SHARE of cost (tier's base) / goods (loyalty's base) — close
        // enough for the on-screen preview; /sale posts the exact per-line number.
        let tierRupeesEff = tierRupees;
        let loyaltyRupeesEff = loyaltyRupees;
        let droppedTier = false;
        let blockedLoyalty = false;
        if (!selected.coupon.stackable) {
            if (selected.coupon.stackScope === "LINE") {
                const totalCost = input.lines.reduce((s, l) => s + (l.costIncl != null ? l.qty * l.costIncl : 0), 0);
                const tierFrac = totalCost > 0 ? eligibleCostBase(selected.coupon, input.lines) / totalCost : 0;
                tierRupeesEff = round2(tierRupees * (1 - tierFrac));
                const goodsFrac = goodsValue > 0 ? eligibleSubtotal(selected.coupon, input.lines) / goodsValue : 0;
                loyaltyRupeesEff = round2(loyaltyRupees * (1 - goodsFrac));
                droppedTier = tierRupeesEff < tierRupees - 0.005;
                blockedLoyalty = loyaltyRupeesEff < loyaltyRupees - 0.005;
            } else {
                tierRupeesEff = 0;
                loyaltyRupeesEff = 0;
                droppedTier = tierRupees > 0;
                blockedLoyalty = loyaltyRupees > 0;
            }
        }

        const config = await prisma.couponConfig.findUnique({ where: { id: 1 } });
        const fin = finalizeCouponAmount({
            selectedDiscount: selected.discountRupees,
            tierRupees: tierRupeesEff, loyaltyRupees: loyaltyRupeesEff, goodsValue,
            maxTotalDiscountPct: config?.maxTotalDiscountPct != null ? Number(config.maxTotalDiscountPct) : null,
            maxCouponDiscountPct: config?.maxCouponDiscountPct != null ? Number(config.maxCouponDiscountPct) : null,
            floorRoomIncl: floorRoom,
        });

        if (fin.couponRupees <= 0) return NextResponse.json({ ok: false, reason: "Coupon yields no discount on this bill" });

        return NextResponse.json({
            ok: true,
            couponId: selected.coupon.id,
            code: selected.coupon.code,
            name: selected.coupon.name,
            discountRupees: fin.couponRupees,
            droppedTier,
            blockedLoyalty,
            clampedByGuard: fin.clampedByGuard,
            couponType: selected.coupon.type,
            freeProductId: selected.coupon.freeProductId,
            freeQty: selected.coupon.freeQty,
            buyProductId: selected.coupon.buyProductId,
            buyQty: selected.coupon.buyQty,
            getQty: selected.coupon.getQty,
            freeDiscountPct: selected.coupon.freeDiscountPct,
            freeProductName: selected.coupon.freeProductId != null ? couponProductNames.get(selected.coupon.freeProductId) ?? null : null,
            buyProductName: selected.coupon.buyProductId != null ? couponProductNames.get(selected.coupon.buyProductId) ?? null : null,
        });
    } catch (e) {
        return handleApiError(e, "Coupon validation failed");
    }
}
