import { z } from "zod";

// ── Bill of Materials (recipes for Manufacturing Journal) ───────────────────

const bomLineSchema = z.object({
    productId: z.number().int().positive(),
    qty:       z.number().positive(),
});

export const invBomCreateSchema = z.object({
    name:            z.string().trim().min(1).max(200),
    outputProductId: z.number().int().positive(),
    outputQty:       z.number().positive(),
    description:     z.string().trim().max(2000).nullish(),
    isActive:        z.boolean().optional().default(true),
    lines:           z.array(bomLineSchema).min(1),
});

export const invBomUpdateSchema = invBomCreateSchema.partial();
