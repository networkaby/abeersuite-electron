import { z } from "zod";

// Coupon — unified promotions (POS + shop). Phase 1 uses PERCENT + FLAT; the
// FREE_ITEM / BOGO fields validate but their discount logic lands later.

export const couponTypeEnum = z.enum(["PERCENT", "FLAT", "FREE_ITEM", "BOGO"]);
export const couponChannelEnum = z.enum(["POS", "SHOP", "BOTH"]);
export const couponApplyModeEnum = z.enum(["CODE", "AUTO"]);
export const couponEligibilityEnum = z.enum(["ANY", "NEW", "RETURNING"]);

// The taxonomy fields on one rule are ANDed by the engine; rules of the same kind
// are ORed. At least one must be set — an all-null rule can never match a line.
const couponRuleSchema = z.object({
    kind:       z.enum(["INCLUDE", "EXCLUDE"]),
    productId:  z.number().int().positive().nullable().optional(),
    categoryId: z.number().int().positive().nullable().optional(),
    groupId:    z.number().int().positive().nullable().optional(),
    brandId:    z.number().int().positive().nullable().optional(),
}).refine(
    (r) => r.productId != null || r.categoryId != null || r.groupId != null || r.brandId != null,
    { message: "A rule needs at least one of product / category / group / brand" },
);

const baseShape = {
    code:            z.string().trim().min(1).max(40).nullable().optional(),
    name:            z.string().trim().min(1).max(80),
    description:     z.string().trim().max(280).nullable().optional(),
    type:            couponTypeEnum,
    channels:        couponChannelEnum.optional(),
    applyMode:       couponApplyModeEnum.optional(),

    percentOff:      z.number().min(0).max(100).nullable().optional(),
    maxDiscountAmt:  z.number().min(0).max(100_000_000).nullable().optional(),
    flatAmt:         z.number().min(0).max(100_000_000).nullable().optional(),
    freeProductId:   z.number().int().positive().nullable().optional(),
    freeQty:         z.number().min(0).max(100_000).nullable().optional(),
    freeDiscountPct: z.number().min(0).max(100).nullable().optional(),
    buyProductId:    z.number().int().positive().nullable().optional(),
    buyQty:          z.number().min(0).max(100_000).nullable().optional(),
    getQty:          z.number().min(0).max(100_000).nullable().optional(),

    startsAt:        z.coerce.date().nullable().optional(),
    endsAt:          z.coerce.date().nullable().optional(),
    minBillValue:    z.number().min(0).max(100_000_000).nullable().optional(),
    totalUsageLimit: z.number().int().min(1).max(10_000_000).nullable().optional(),
    perCustomerLimit:z.number().int().min(1).max(10_000_000).nullable().optional(),
    singleUse:       z.boolean().optional(),
    eligibility:     couponEligibilityEnum.optional(),
    stackable:       z.boolean().optional(),
    ownerAccountId:  z.number().int().positive().nullable().optional(),
    isActive:        z.boolean().optional(),
    rules:           z.array(couponRuleSchema).max(200).optional(),
};

// Per-type required fields + CODE coupons must carry a code.
function refineCoupon(
    data: { type?: string; applyMode?: string; code?: string | null; percentOff?: number | null; flatAmt?: number | null },
    ctx: z.RefinementCtx,
) {
    if (data.type === "PERCENT" && (data.percentOff == null)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["percentOff"], message: "Percent coupons need a % off" });
    }
    if (data.type === "FLAT" && (data.flatAmt == null)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["flatAmt"], message: "Flat coupons need an amount" });
    }
    // A CODE coupon (default applyMode) must have a code; AUTO coupons must not.
    const mode = data.applyMode ?? "CODE";
    if (mode === "CODE" && !data.code) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["code"], message: "Code-entry coupons need a code" });
    }
}

export const couponSchema = z.object(baseShape).superRefine(refineCoupon);
export type CouponInput = z.infer<typeof couponSchema>;

export type CouponRuleInput = z.infer<typeof couponRuleSchema>;

/// Validated rule → Prisma create row. Shared by the create + replace paths so the
/// taxonomy field list lives in exactly one place.
export const toCouponRuleCreate = (r: CouponRuleInput) => ({
    kind: r.kind,
    productId: r.productId ?? null,
    categoryId: r.categoryId ?? null,
    groupId: r.groupId ?? null,
    brandId: r.brandId ?? null,
});

// Partial — inline edits change one field at a time; the create path owns the
// per-type/code invariants, and the existing row already satisfies them.
export const couponUpdateSchema = z.object({ ...baseShape, type: couponTypeEnum.optional() }).partial();
export type CouponUpdateInput = z.infer<typeof couponUpdateSchema>;
