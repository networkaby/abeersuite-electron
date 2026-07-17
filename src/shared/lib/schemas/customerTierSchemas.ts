import { z } from "zod";

// A bracket edge, in days-ago: today .. 10 years back. Mirrors loyaltyConfigUpdateSchema's
// expiryDays ceiling.
const dayBound = z.number().int().min(0).max(3650);

// Bracket the starter period covers — see @default on CustomerTierPeriod in accounts.prisma.
export const DEFAULT_TIER_FROM_DAY = 0;
export const DEFAULT_TIER_TO_DAY = 180;

/** A bracket is only meaningful when it ends further back than it starts. */
export const isValidBracket = (fromDay: number, toDay: number) => toDay > fromDay;

// Who the bill on the counter counts for. Mirrors the TierCurrentSaleScope enum.
export const tierCurrentSaleScopeSchema = z.enum(["NONE", "NEW", "RETURNING", "ALL"]);

// CustomerTierPeriod — a bracket of history + the title earned in it ("Best of the
// month"). Each period owns its own set of levels (CustomerTier rows).
export const customerTierPeriodSchema = z.object({
    name:             z.string().trim().min(1).max(40),
    fromDay:          dayBound,
    toDay:            dayBound,
    currentSaleScope: tierCurrentSaleScopeSchema.optional(),
    currentSaleOnly:  z.boolean().optional(),
    enabled:          z.boolean().optional(),
    sortOrder:        z.number().int().min(0).optional(),
}).refine((d) => isValidBracket(d.fromDay, d.toDay), {
    message: "The bracket must end further back than it starts (to-day > from-day)",
    path: ["toDay"],
});
export type CustomerTierPeriodInput = z.infer<typeof customerTierPeriodSchema>;

// Partial — the page patches one field at a time, so fromDay/toDay cannot be compared
// here. The route merges the patch onto the stored row and checks isValidBracket there.
export const customerTierPeriodUpdateSchema = z.object({
    name:             z.string().trim().min(1).max(40).optional(),
    fromDay:          dayBound.optional(),
    toDay:            dayBound.optional(),
    currentSaleScope: tierCurrentSaleScopeSchema.optional(),
    currentSaleOnly:  z.boolean().optional(),
    enabled:          z.boolean().optional(),
    sortOrder:        z.number().int().min(0).optional(),
});
export type CustomerTierPeriodUpdateInput = z.infer<typeof customerTierPeriodUpdateSchema>;

// CustomerTier — one level inside a period (admin-managed: name, threshold, %, on/off).
export const customerTierSchema = z.object({
    name:        z.string().trim().min(1).max(40),
    minSpend:    z.number().min(0).max(100_000_000),
    discountPct: z.number().min(0).max(100),
    enabled:     z.boolean().optional(),
    sortOrder:   z.number().int().min(0).optional(),
    // Which period this level belongs to. Required for new levels — only the legacy
    // pre-period rows are allowed to have none (see the bridge in accounts.prisma).
    periodId:    z.number().int().positive(),
});
export type CustomerTierInput = z.infer<typeof customerTierSchema>;

export const customerTierUpdateSchema = z.object({
    name:        z.string().trim().min(1).max(40).optional(),
    minSpend:    z.number().min(0).max(100_000_000).optional(),
    discountPct: z.number().min(0).max(100).optional(),
    enabled:     z.boolean().optional(),
    sortOrder:   z.number().int().min(0).optional(),
});
export type CustomerTierUpdateInput = z.infer<typeof customerTierUpdateSchema>;
