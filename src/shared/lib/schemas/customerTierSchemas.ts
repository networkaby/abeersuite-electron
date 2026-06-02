import { z } from "zod";

// CustomerTier — spend-tier auto-discount (admin-managed: name, threshold, %, on/off).
export const customerTierSchema = z.object({
    name:        z.string().trim().min(1).max(40),
    minSpend:    z.number().min(0).max(100_000_000),
    discountPct: z.number().min(0).max(100),
    enabled:     z.boolean().optional(),
    sortOrder:   z.number().int().min(0).optional(),
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
