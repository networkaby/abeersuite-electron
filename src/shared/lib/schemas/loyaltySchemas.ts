import { z } from "zod";

// LoyaltyConfig (singleton) — editable rates. redeemExpenseAccountId is wired by
// the bootstrap seed and intentionally NOT editable through the API.
export const loyaltyConfigUpdateSchema = z.object({
    enabled:               z.boolean().optional(),
    earnEnabled:           z.boolean().optional(),
    redeemEnabled:         z.boolean().optional(),
    globalEarnRatePer:     z.number().positive().max(1_000_000).optional(),
    redeemValue:           z.number().positive().max(1_000_000).optional(),
    expiryEnabled:         z.boolean().optional(),
    expiryDays:            z.number().int().min(1).max(36_500).optional(),
    minEarnInvoiceValue:   z.number().min(0).nullable().optional(),
    minRedeemInvoiceValue: z.number().min(0).nullable().optional(),
    minRedeemPoints:       z.number().int().min(0).nullable().optional(),
    maxRedeemPctOfBill:    z.number().min(0).max(100).nullable().optional(),
});
export type LoyaltyConfigUpdateInput = z.infer<typeof loyaltyConfigUpdateSchema>;

// LoyaltyEarnRule — a per category/group/product multiplier override. Exactly one
// target id must be set, matching `scope`.
export const loyaltyEarnRuleSchema = z
    .object({
        scope:      z.enum(["CATEGORY", "GROUP", "PRODUCT"]),
        categoryId: z.number().int().positive().nullable().optional(),
        groupId:    z.number().int().positive().nullable().optional(),
        productId:  z.number().int().positive().nullable().optional(),
        multiplier: z.number().min(0).max(100),
        redeemCapPct: z.number().min(0).max(100).nullable().optional(),
        enabled:    z.boolean().optional(),
    })
    .refine(
        (r) =>
            (r.scope === "CATEGORY" && r.categoryId != null && r.groupId == null && r.productId == null) ||
            (r.scope === "GROUP" && r.groupId != null && r.categoryId == null && r.productId == null) ||
            (r.scope === "PRODUCT" && r.productId != null && r.categoryId == null && r.groupId == null),
        { message: "Exactly one target id must be set, matching the chosen scope." },
    );
export type LoyaltyEarnRuleInput = z.infer<typeof loyaltyEarnRuleSchema>;

// Partial update for an existing rule (only the multiplier / enabled flag).
export const loyaltyEarnRuleUpdateSchema = z.object({
    multiplier:   z.number().min(0).max(100).optional(),
    redeemCapPct: z.number().min(0).max(100).nullable().optional(),
    enabled:      z.boolean().optional(),
});
export type LoyaltyEarnRuleUpdateInput = z.infer<typeof loyaltyEarnRuleUpdateSchema>;

// LoyaltyMilestone — a lifetime-spend tier that grants one-time bonus points.
export const loyaltyMilestoneSchema = z.object({
    threshold:   z.number().positive().max(100_000_000),
    bonusPoints: z.number().int().positive().max(10_000_000),
    label:       z.string().trim().max(120).nullable().optional(),
    enabled:     z.boolean().optional(),
});
export type LoyaltyMilestoneInput = z.infer<typeof loyaltyMilestoneSchema>;

export const loyaltyMilestoneUpdateSchema = z.object({
    threshold:   z.number().positive().max(100_000_000).optional(),
    bonusPoints: z.number().int().positive().max(10_000_000).optional(),
    label:       z.string().trim().max(120).nullable().optional(),
    enabled:     z.boolean().optional(),
});
export type LoyaltyMilestoneUpdateInput = z.infer<typeof loyaltyMilestoneUpdateSchema>;

// Manual admin adjustment of a customer's points balance.
export const loyaltyAdjustSchema = z.object({
    accountId: z.number().int().positive(),
    delta:     z.number().int().refine((n) => n !== 0, "Adjustment must be non-zero."),
    note:      z.string().trim().max(500).optional(),
});
export type LoyaltyAdjustInput = z.infer<typeof loyaltyAdjustSchema>;
