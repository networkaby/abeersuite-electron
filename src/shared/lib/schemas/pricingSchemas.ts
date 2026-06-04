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

// NOTE: the legacy PricingStrategy create/update schemas were removed when the
// PricingStrategy engine was dropped in favour of the additive StrategyPoint
// model (see `strategyPointsSaveSchema` below + `additiveMargin.ts`).

// Per-product pricing fields editable from the Items / Needs Attention pages.
// All optional — callers patch only the columns they're touching.
//
// `effectiveSalePricePaise` flips `priceOverridden=true` when set (manual price lock).
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
        effectiveSalePricePaise: z.number().int().min(0).nullable().optional(),
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

// ── Sticky Sale Price (Update & Print Labels "Freeze sale price") ───────────
// Bulk-freeze: each row carries which voice sells + (for SAVED) the frozen
// price in paise and the decided after-tax profit. SAVED writes savedSalePricePaise
// (MRP-capped server-side) + stamps salePriceFrozenAt; STRATEGY/COMPUTED clear
// the frozen fields so POS/storefront fall back to the live engine.
export const effectiveSalePriceSourceEnum = z.enum(["STRATEGY", "COMPUTED", "SAVED"]);
export const salePriceSaveSchema = z.object({
    items: z
        .array(
            z.object({
                id:                       z.number().int().positive(),
                effectiveSalePriceSource: effectiveSalePriceSourceEnum,
                savedSalePricePaise:      z.number().int().min(0).nullable(),
                savedProfitPaise:         z.number().int().nullable(),
            }),
        )
        .min(1)
        .max(2000),
});

export type SalePriceSaveInput = z.infer<typeof salePriceSaveSchema>;

// ── Strategy points (additive-margin model) ───────────────────────────────
// The single org-wide points configuration. GET and PUT share this grouped
// shape: `base` is the baseline; `brand`/`category`/`group` map a master id
// (string) → points; `product` maps a product id (string) → points (a per-SKU
// additive override); the *_band maps key on a band key. Points may be negative
// (a value can pull margin down) and are stored as Decimal(8,2). Zero points
// are dropped server-side (a missing entry means 0).
const pointsMap = z.record(z.string().max(64), z.number().gte(-100_000).lte(100_000));

export const strategyPointsSaveSchema = z.object({
    base:      z.number().gte(-100_000).lte(100_000).default(0),
    brand:     pointsMap.default({}),
    category:  pointsMap.default({}),
    group:     pointsMap.default({}),
    product:   pointsMap.default({}),
    stockBand: pointsMap.default({}),
    ageBand:   pointsMap.default({}),
    moveBand:  pointsMap.default({}),
});

export type StrategyPointsSaveInput = z.infer<typeof strategyPointsSaveSchema>;
/** The grouped shape returned by GET /api/pricing-strategy/points. */
export type StrategyPoints = StrategyPointsSaveInput;
