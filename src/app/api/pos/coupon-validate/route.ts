import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { selectCouponForCart, finalizeCouponAmount, type EvalInput } from "@/modules/coupons/lib";

// POST /api/pos/coupon-validate — validate a coupon code (or pick the best auto
// coupon) against the current cart. Returns the SAME ₹ the sale route will post,
// plus the stacking effect, so the POS total matches the server total exactly.

const lineSchema = z.object({
    productId:  z.number().int(),
    groupId:    z.number().int().nullable().optional(),
    categoryId: z.number().int().nullable().optional(),
    qty:        z.number().min(0),
    unitPrice:  z.number().min(0),
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
        const goodsValue = data.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
        const tierRupees = data.tierRupees ?? 0;
        const loyaltyRupees = data.loyaltyRupees ?? 0;

        const input: EvalInput = {
            accountId: data.accountId ?? null,
            lines: data.lines.map((l) => ({ productId: l.productId, groupId: l.groupId ?? null, categoryId: l.categoryId ?? null, qty: l.qty, unitPrice: l.unitPrice })),
            goodsValue,
            // Coupon-alone ceiling; finalizeCouponAmount applies the stacking-aware ceiling.
            billBeforeCoupon: goodsValue,
            isNewCustomer: data.isNewCustomer ?? false,
            now: new Date(),
        };

        const selected = await selectCouponForCart(prisma, { code: data.code, autoApply: data.autoApply, channel: "POS", input });
        if (selected.kind === "none") return NextResponse.json({ ok: false, reason: data.code ? "No coupon applied" : "No automatic offer available" });
        if (selected.kind === "error") return NextResponse.json({ ok: false, reason: selected.reason });

        const config = await prisma.couponConfig.findUnique({ where: { id: 1 } });
        const fin = finalizeCouponAmount({
            selectedDiscount: selected.discountRupees,
            tierRupees, loyaltyRupees, goodsValue,
            couponStackable: selected.coupon.stackable,
            maxTotalDiscountPct: config?.maxTotalDiscountPct != null ? Number(config.maxTotalDiscountPct) : null,
        });

        if (fin.couponRupees <= 0) return NextResponse.json({ ok: false, reason: "Coupon yields no discount on this bill" });

        return NextResponse.json({
            ok: true,
            couponId: selected.coupon.id,
            code: selected.coupon.code,
            name: selected.coupon.name,
            discountRupees: fin.couponRupees,
            droppedTier: fin.droppedTier,
            blockedLoyalty: fin.blockedLoyalty,
            clampedByGuard: fin.clampedByGuard,
        });
    } catch (e) {
        return handleApiError(e, "Coupon validation failed");
    }
}
