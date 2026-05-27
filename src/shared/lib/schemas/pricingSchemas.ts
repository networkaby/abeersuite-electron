import { z } from "zod";

/** Allowed CostMethod values — mirrors prisma enum CostMethod. */
export const costMethodEnum = z.enum([
    "WEIGHTED_AVG",
    "SIMPLE_AVG",
    "FIFO",
    "LAST_INWARD",
    "MONTHLY_AVG",
]);

// ── Attribute-filter spec ─────────────────────────────────────────────────
// A strategy can gate matches on InvProduct.attrsJson values. Shape:
//   { "<attrKey>": { op: "eq", value: "Black" } }
//   { "<attrKey>": { op: "in", value: ["Black", "White"] } }
//   { "<attrKey>": { op: "gte", value: 100 } }
//   { "<attrKey>": { op: "lte", value: 500 } }
//   { "<attrKey>": { op: "between", value: [100, 500] } }
//
// Multiple keys AND together. Missing keys on the product fail the match
// (the attribute filter is an explicit positive assertion).
export const attrFilterOpEnum = z.enum(["eq", "in", "gte", "lte", "between"]);

const attrFilterValueSchema = z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.union([z.string(), z.number()])),
]);

export const attrFilterEntrySchema = z.object({
    op:    attrFilterOpEnum,
    value: attrFilterValueSchema,
});

export const attrFiltersSchema = z.record(z.string(), attrFilterEntrySchema);

export type AttrFilterEntry = z.infer<typeof attrFilterEntrySchema>;
export type AttrFilters     = z.infer<typeof attrFiltersSchema>;

// ── Strategy create/update ────────────────────────────────────────────────

const baseStrategyShape = z.object({
    name:            z.string().trim().min(1).max(120),
    // Taxonomy multi-match — empty = "any". For group/category, the matcher
    // walks descendants so the user only picks roots.
    brandIds:        z.array(z.number().int().positive()).default([]),
    groupIds:        z.array(z.number().int().positive()).default([]),
    categoryIds:     z.array(z.number().int().positive()).default([]),
    attrFilters:     attrFiltersSchema.nullable().optional(),
    minCostPaise:    z.number().int().min(0).nullable().optional(),
    maxCostPaise:    z.number().int().min(0).nullable().optional(),
    minStock:        z.number().int().min(0).nullable().optional(),
    maxStock:        z.number().int().min(0).nullable().optional(),
    minStaleDays:    z.number().int().min(0).nullable().optional(),
    maxStaleDays:    z.number().int().min(0).nullable().optional(),
    markupPercent:   z.number().gte(-100).lte(10_000),
    markupFlatPaise: z.number().int().min(0),
    roundingPaise:   z.number().int().min(0),
    priority:        z.number().int(),
    /** Strategy-level default cost method. null = no override, products use their own. */
    costMethod:      costMethodEnum.nullable().optional(),
    isActive:        z.boolean().optional(),
});

// Cross-field: max ≥ min on every range.
function refineRanges(
    value: {
        minCostPaise?: number | null;
        maxCostPaise?: number | null;
        minStock?:     number | null;
        maxStock?:     number | null;
        minStaleDays?: number | null;
        maxStaleDays?: number | null;
    },
    ctx: z.RefinementCtx,
): void {
    if (value.minCostPaise != null && value.maxCostPaise != null && value.maxCostPaise < value.minCostPaise) {
        ctx.addIssue({ code: "custom", path: ["maxCostPaise"], message: "maxCostPaise must be ≥ minCostPaise" });
    }
    if (value.minStock != null && value.maxStock != null && value.maxStock < value.minStock) {
        ctx.addIssue({ code: "custom", path: ["maxStock"], message: "maxStock must be ≥ minStock" });
    }
    if (value.minStaleDays != null && value.maxStaleDays != null && value.maxStaleDays < value.minStaleDays) {
        ctx.addIssue({ code: "custom", path: ["maxStaleDays"], message: "maxStaleDays must be ≥ minStaleDays" });
    }
}

export const pricingStrategyCreateSchema = baseStrategyShape.superRefine(refineRanges);

export const pricingStrategyUpdateSchema = baseStrategyShape
    .partial()
    .superRefine(refineRanges);

export type PricingStrategyCreateInput = z.infer<typeof pricingStrategyCreateSchema>;
export type PricingStrategyUpdateInput = z.infer<typeof pricingStrategyUpdateSchema>;

// Per-product pricing fields editable from the Items / Needs Attention pages.
// All optional — callers patch only the columns they're touching.
//
// `pricePaise` flips `priceOverridden=true` when set (manual price lock).
//
// `openingRatePaise` is the Tally-style opening unit cost (excl-GST). It
// writes to InvProduct.openingRate (Decimal rupees) and is picked up by the
// cost resolver as the synthetic first lot. PR 3 dropped the costPaise
// cache, so there's no separate cache field to mirror anymore.
export const pricingItemUpdateSchema = z
    .object({
        /** Per-item cost method. null = inherit from matched strategy. */
        costMethod:       costMethodEnum.nullable().optional(),
        marginPercent:    z.number().gte(-100).lte(10_000).nullable().optional(),
        priceOverridden:  z.boolean().optional(),
        pricePaise:       z.number().int().min(0).nullable().optional(),
        mrpPaise:         z.number().int().min(0).nullable().optional(),
        openingRatePaise: z.number().int().min(0).nullable().optional(),
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
