import { z } from "zod";
import { hhMmSchema } from "./commonSchemas";

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

/**
 * Barcode-label design, saved on OrgDefaults.labelTemplateJson.
 *
 * Barcode labels are the documented EXCEPTION to the voucher print-template
 * surface: they are designed in the settings bar on Pricing Strategy → Print
 * labels and saved here, so the next person to print gets the same label
 * without redoing the switches.
 *
 * Every field optional — a template saved before a new switch existed must keep
 * loading, with the code default filling the gap (see LABEL_TEMPLATE_DEFAULTS).
 */
export const labelTemplateSchema = z.object({
    /// Which size preset was last chosen (LabelDesigner PRESETS id).
    presetId:       z.string().max(40),
    showHeader:     z.boolean(),
    /// Store name printed across the top of every label.
    header:         z.string().max(60),
    showMrp:        z.boolean(),
    showSecret:     z.boolean(),
    /// Caption printed before the selling price ("Offer", "Rate", …). Empty =
    /// price prints bare, which is the long-standing behaviour. MRP's own
    /// caption is fixed and not customisable.
    salePriceLabel: z.string().max(16),
    /// Which edge the staff-only secret date code runs down.
    side:           z.enum(["left", "right"]),
    orientation:    z.enum(["spine", "upright"]),
}).partial();
export type LabelTemplate = z.infer<typeof labelTemplateSchema>;

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
    /// Universal movement-class bands (days since last sale) — group/category
    /// overrides win; these are the final fallback.
    reorderSlowAfterDays:        z.number().int().min(1).max(3650).optional(),
    reorderNonMovingAfterDays:   z.number().int().min(1).max(3650).optional(),
    reorderDeadAfterDays:        z.number().int().min(1).max(3650).optional(),
    /// Never-sold products younger than this classify as "New" (floor-only).
    reorderNewItemDays:          z.number().int().min(1).max(3650).optional(),
    /// Clearance detector: sale at realized pre-tax unit ≤ cost × (1 + this%)
    /// = clearance, never demand (excluded from usage + the revival ladder).
    clearanceMarginCutoffPct:    z.number().min(0).max(100).optional(),
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
    /// Barcode-label design (Print labels settings bar). See labelTemplateSchema.
    labelTemplateJson:          labelTemplateSchema.optional(),
    /// Pay rules (HR → Pay Rules) — how time turns into money for the whole shop.
    /// Multiples and counts only, never a rupee. Bounds match `parsePayRules`,
    /// which is the defensive read on the way back out. See shared/lib/hr/payRules.
    hrPayRulesJson: z.object({
        fullDayPct:        z.number().min(0).max(100),
        halfDayPct:        z.number().min(0).max(100),
        overtimeRate:      z.number().min(0).max(10),
        shortHoursRate:    z.number().min(0).max(10),
        weeklyOffRate:     z.number().min(0).max(10),
        holidayRate:       z.number().min(0).max(10),
        absentPenaltyDays: z.number().min(0).max(31),
        leaveNoticeDays:   z.number().min(0).max(90),
        lateGraceMinutes:  z.number().min(0).max(240),
        lateFreeDays:      z.number().min(0).max(31),
        latePenaltyStyle:  z.enum(["none", "pay", "timesLate", "sharePerSlab", "shareOfDay"]),
        latePenaltyDays:   z.number().min(0).max(31),
        lateTimesLate:     z.number().min(0).max(20),
        lateSlabPct:       z.number().min(0).max(100),
        lateSlabMinutes:   z.number().min(0).max(240),
        lateSharePct:      z.number().min(0).max(100),
    }).optional(),
    /// Office hours (HR → Calendar & Hours). Two openings, one per solstice; every
    /// other day of the year is interpolated on a cosine. Closing does not move.
    /// Same "HH:MM" shape as StaffProfile.dutyStart, so the two validate alike.
    dutySummerStart:            hhMmSchema.optional(),
    dutyWinterStart:            hhMmSchema.optional(),
    dutyEnd:                    hhMmSchema.optional(),
    /// Days the whole shop is closed, 0 = Sunday. Deduped and sorted so the
    /// stored array is stable no matter which order the toggles were pressed.
    weeklyOff:                  z.array(z.number().int().min(0).max(6))
        .max(7)
        .transform((arr) => [...new Set(arr)].sort((a, b) => a - b))
        .optional(),
});

export type OrgDefaultsUpdateInput = z.infer<typeof orgDefaultsUpdateSchema>;
