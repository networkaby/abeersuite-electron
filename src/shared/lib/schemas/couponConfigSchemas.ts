import { z } from "zod";

// CouponConfig singleton — global stacking guard + dedicated GL ledger wiring.
export const couponConfigUpdateSchema = z.object({
    maxTotalDiscountPct:        z.number().min(0).max(100).nullable().optional(),
    maxCouponDiscountPct:       z.number().min(0).max(100).nullable().optional(),
    maxTierDiscountPct:         z.number().min(0).max(100).nullable().optional(),
    couponExpenseAccountId:     z.number().int().positive().nullable().optional(),
    giftCardLiabilityAccountId: z.number().int().positive().nullable().optional(),
});
export type CouponConfigUpdateInput = z.infer<typeof couponConfigUpdateSchema>;
