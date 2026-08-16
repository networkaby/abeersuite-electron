import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { selectCouponForCart, finalizeCouponAmount, eligibleCostBase, eligibleSubtotal, type EvalInput } from "@/modules/coupons/lib";
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
            // Coupon-alone ceiling; finalizeCouponAmount applies the stacking-aware ceiling.
            billBeforeCoupon: goodsValue,
            isNewCustomer: data.isNewCustomer ?? false,
            now: new Date(),
        };

        const selected = await selectCouponForCart(prisma, { code: data.code, autoApply: data.autoApply, channel: "POS", input });
        if (selected.kind === "none") return NextResponse.json({ ok: false, reason: data.code ? "No coupon applied" : "No automatic offer available" });
        if (selected.kind === "error") return NextResponse.json({ ok: false, reason: selected.reason });

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
