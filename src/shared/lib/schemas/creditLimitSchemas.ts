import { z } from "zod";

// CreditLimitConfig (singleton) — the global auto credit-limit calculator.
// Auto limit = pctOfSales% of a customer's POSTED sales in the last windowDays;
// the effective limit is the higher of that and the per-customer manual limit.
export const creditLimitConfigUpdateSchema = z.object({
    autoEnabled:  z.boolean().optional(),
    windowDays:   z.number().int().min(1).max(3_650).optional(),
    pctOfSales:   z.number().min(0).max(1_000).optional(),
    maxAutoLimit: z.number().min(0).max(1_000_000_000).nullable().optional(),
    roundToStep:  z.number().int().min(0).max(1_000_000).optional(),
});
export type CreditLimitConfigUpdateInput = z.infer<typeof creditLimitConfigUpdateSchema>;
