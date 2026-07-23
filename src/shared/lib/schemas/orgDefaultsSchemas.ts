import { z } from "zod";

const TAXABILITY = ["TAXABLE", "EXEMPT", "NIL_RATED", "NON_GST"] as const;
const VALUATION_METHOD = ["WEIGHTED_AVG", "SIMPLE_AVG", "FIFO", "LAST_INWARD", "MONTHLY_AVG"] as const;

const trimToNullable = (maxLen: number) =>
    z
        .union([z.string(), z.null(), z.undefined()])
        .transform((v) => {
            if (v === undefined || v === null) return null;
            const t = String(v).trim();
            if (t === "") return null;
            return t.slice(0, maxLen);
        });

/// Single barcode band — exported so the settings editor + label page share one shape.
export const barcodeBandSchema = z.object({
    max:  z.number().int().positive(),
    add:  z.number().int().min(0),
    hint: z.number().int().min(0).max(9),
});
export type BarcodeBand = z.infer<typeof barcodeBandSchema>;

export const orgDefaultsUpdateSchema = z.object({
    defaultUnitId:              z.number().int().positive().nullable().optional(),
    /// FK to GstRate master — used as the final fallback in the cascading
    /// product → group → org-default lookup.
    defaultGstRateId:           z.number().int().positive().nullable().optional(),
    defaultHsnCode:             trimToNullable(32).optional(),
    defaultTaxability:          z.enum(TAXABILITY).nullable().optional(),
    /// Default stock-valuation method — drives BS closing stock, stock-summary,
    /// and pricing fallback when product.costMethod and strategy.costMethod
    /// are both null. UI dropdowns initialise from this value.
    valuationMethod:            z.enum(VALUATION_METHOD).optional(),
    defaultSaleCreditPeriod:     z.number().int().min(0).nullable().optional(),
    defaultPurchaseCreditPeriod: z.number().int().min(0).nullable().optional(),
    /// Fallback supplier lead time (days) for the reorder-point check when a
    /// product has no leadTimeDays of its own.
    defaultLeadTimeDays:         z.number().int().min(0).max(365).optional(),
    /// AccountGroup whose POSTED debits feed the pricing-strategy additional-cost
    /// "waiting" pool (Costing page). Decision-support only — never posts to GL.
    shippingPoolGroupId:        z.number().int().positive().nullable().optional(),
    defaultCurrencySymbol:      z.string().trim().min(1).max(8).optional(),
    /// Barcode price bands for Update & Print Labels — [{max, add, hint}].
    barcodeBandsJson:           z.array(barcodeBandSchema).max(32).optional(),
    /// Cash denominations for the POS shift-close counter. Positive integers;
    /// deduped and sorted high → low so the counter always renders top-down.
    cashDenominationsJson:      z.array(z.number().int().positive())
        .max(40)
        .transform((arr) => [...new Set(arr)].sort((a, b) => b - a))
        .optional(),
    /// POS Estimate print — which discount lines are shown on the customer copy.
    /// Default (all false) hides every discount so the customer sees the tag price.
    posEstimateShowDiscountsJson: z.object({
        tier:    z.boolean(),
        loyalty: z.boolean(),
        coupon:  z.boolean(),
        manual:  z.boolean(),
    }).optional(),
});

export type OrgDefaultsUpdateInput = z.infer<typeof orgDefaultsUpdateSchema>;
