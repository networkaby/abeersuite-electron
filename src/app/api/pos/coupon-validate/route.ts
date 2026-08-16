import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { selectCouponForCart, selectCouponForCartById, selectFreeGrantCoupon, selectAutoFreeGrant, finalizeCouponAmount, eligibleCostBase, eligibleSubtotal, type EvalInput, type CouponSelection } from "@/modules/coupons/lib";
import { round2 } from "@/shared/lib/format";
import { resolveEffectiveCostMap } from "@/modules/pricing-strategy/lib/resolveCost";
import { loadProtectedProductIds } from "@/modules/retention/lib/protection";

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
    // cost-incl-tax, the PERCENT-coupon base. Same snapshot /sale receives.
    taxRate:    z.number().min(0).max(100).optional(),
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
        // Customer Quality: no-discount flag — flagged customer gets no coupons.
        // Same generic wording as an ineligible coupon, so nothing is revealed.
        if (data.accountId != null) {
            const acct = await prisma.account.findUnique({
                where:  { id: data.accountId },
                select: { person: { select: { noDiscount: true } }, company: { select: { noDiscount: true } } },
            });
            if ((acct?.person?.noDiscount ?? acct?.company?.noDiscount) === true) {
                return NextResponse.json({ ok: false, reason: data.code ? "No coupon applied" : "No automatic offer available" });
            }
        }

        const goodsValue = data.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
        const tierRupees = data.tierRupees ?? 0;
        const loyaltyRupees = data.loyaltyRupees ?? 0;

        // Resolve each line's taxonomy + effective cost server-side (the POS client
        // doesn't send them) so include/exclude rules AND the PERCENT base evaluate
        // IDENTICALLY here and in /sale.
        const productIds = [...new Set(data.lines.map((l) => l.productId))];
        const [products, costPaiseById, protectedProductIds] = await Promise.all([
            prisma.invProduct.findMany({ where: { id: { in: productIds } }, select: { id: true, groupId: true, categoryId: true, brandId: true } }),
            resolveEffectiveCostMap(productIds),
            loadProtectedProductIds(prisma),
        ]);
        const taxById = new Map(products.map((p) => [p.id, p]));

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
                    // Cost incl. tax — the PERCENT-coupon base (same as the tier's).
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

        // ── Selection: the dedicated free-grant slot, or the money coupon ──
        // A typed code that turns out to be an independent free-grant coupon is
        // routed here too, so one code in either box lands in the right place.
        let selected: CouponSelection = { kind: "none" };
        let freeSelected: Extract<CouponSelection, { kind: "free-grant" }> | null = null;
        if (data.freeCode) {
            const sel = await selectFreeGrantCoupon(prisma, { code: data.freeCode, channel: "POS", input, protectedProductIds });
            if (sel.kind === "error") return NextResponse.json({ ok: false, reason: sel.reason });
            freeSelected = sel;
        } else if (data.freeAutoApply) {
            const sel = await selectAutoFreeGrant(prisma, { channel: "POS", input, protectedProductIds });
            if (sel.kind === "error") return NextResponse.json({ ok: false, reason: sel.reason });
            if (sel.kind === "free-grant") freeSelected = sel;
        } else if (data.couponId != null) {
            // Force-apply a specific coupon by id (AUTO — no code). A free-grant
            // id is routed to the free slot automatically.
            selected = await selectCouponForCartById(prisma, { couponId: data.couponId, channel: "POS", input, protectedProductIds });
            if (selected.kind === "free-grant") {
                freeSelected = selected;
                selected = { kind: "none" };
            } else if (selected.kind === "error") {
                return NextResponse.json({ ok: false, reason: selected.reason });
            }
        } else {
            selected = await selectCouponForCart(prisma, { code: data.code, autoApply: data.autoApply, channel: "POS", input });
            if (selected.kind === "free-grant") {
                freeSelected = selected;
            } else if (selected.kind === "none") {
                return NextResponse.json({ ok: false, reason: data.code ? "No coupon applied" : "No automatic offer available" });
            } else if (selected.kind === "error") {
                return NextResponse.json({ ok: false, reason: selected.reason });
            }
        }

        // Free-grant response: the items to add as zero-price FREE lines. No ₹,
        // no tier/loyalty interplay — the grant rides on top of everything.
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

        // The free-grant path returned above — the money coupon won, so the
        // selection is narrowed to a ₹ discount here.
        if (selected.kind !== "ok") {
            return NextResponse.json({ ok: false, reason: "No coupon applied" });
        }

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
        });
    } catch (e) {
        return handleApiError(e, "Coupon validation failed");
    }
}
