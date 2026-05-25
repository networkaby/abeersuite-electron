import { z } from "zod";

/** Allowed PricingScope values — mirrors prisma enum PricingScope. */
export const pricingScopeEnum = z.enum(["ORG", "CATEGORY", "GROUP", "BRAND"]);

/** Allowed CostMethod values — mirrors prisma enum CostMethod. */
export const costMethodEnum = z.enum([
    "WEIGHTED_AVG_COST",
    "FIFO",
    "LAST_PURCHASE_COST",
    "MONTHLY_AVG_COST",
    "STD_COST",
]);

const baseStrategyShape = z.object({
    name:            z.string().trim().min(1).max(120),
    scope:           pricingScopeEnum,
    scopeId:         z.number().int().positive().nullable(),
    markupPercent:   z.number().gte(-100).lte(10_000),
    markupFlatPaise: z.number().int().min(0),
    roundingPaise:   z.number().int().min(0),
    priority:        z.number().int(),
    isActive:        z.boolean().optional(),
});

// ORG → scopeId must be null. Other scopes → scopeId must be a positive int.
function refineScopeId<T extends { scope: string; scopeId: number | null | undefined }>(
    value: T,
    ctx: z.RefinementCtx,
): void {
    if (value.scope === "ORG") {
        if (value.scopeId != null) {
            ctx.addIssue({
                code: "custom",
                path: ["scopeId"],
                message: "ORG scope must not have a scopeId",
            });
        }
    } else {
        if (value.scopeId == null) {
            ctx.addIssue({
                code: "custom",
                path: ["scopeId"],
                message: `${value.scope} scope requires a scopeId`,
            });
        }
    }
}

export const pricingStrategyCreateSchema = baseStrategyShape.superRefine(refineScopeId);

export const pricingStrategyUpdateSchema = baseStrategyShape
    .partial()
    .superRefine((value, ctx) => {
        // Only validate scope/scopeId pairing if BOTH are present in the patch
        // (caller may update one without the other; the API endpoint reads the
        // existing row and re-validates against the merged result).
        if (value.scope !== undefined && value.scopeId !== undefined) {
            refineScopeId(
                { scope: value.scope, scopeId: value.scopeId },
                ctx,
            );
        }
    });

export type PricingStrategyCreateInput = z.infer<typeof pricingStrategyCreateSchema>;
export type PricingStrategyUpdateInput = z.infer<typeof pricingStrategyUpdateSchema>;

// Per-product pricing fields editable from the Items table. All optional —
// callers patch only the columns they're touching. Setting `pricePaise`
// explicitly is what flips `priceOverridden=true`; the UI sends both
// together when the user types a manual price.
export const pricingItemUpdateSchema = z
    .object({
        costMethod:      costMethodEnum.optional(),
        marginPercent:   z.number().gte(-100).lte(10_000).nullable().optional(),
        priceOverridden: z.boolean().optional(),
        pricePaise:      z.number().int().min(0).nullable().optional(),
        stdCostPaise:    z.number().int().min(0).nullable().optional(),
    });

export type PricingItemUpdateInput = z.infer<typeof pricingItemUpdateSchema>;

// Bulk apply: either explicit ids or "all eligible". When `productIds` is
// omitted, the endpoint targets every active product where priceOverridden
// is false. `forceOverridden` bypasses the override guard (lets you
// reset all prices to formula on demand).
export const pricingApplySchema = z.object({
    productIds:      z.array(z.number().int().positive()).optional(),
    forceOverridden: z.boolean().optional(),
});

export type PricingApplyInput = z.infer<typeof pricingApplySchema>;
