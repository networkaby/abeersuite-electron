import { z } from "zod";

// Create payload for a CostPoolDraw — the pricing-strategy additional-cost layer.
// Discriminated by `kind`:
//   ALLOCATION → must name a product + per-unit surcharge (GST-exclusive paise).
//   DISMISSAL  → office-expense write-off; product/per-unit omitted.
// Both draw `amountPaise` from a specific posted debit (`sourceGlLineId`, a spine
// VoucherGlLine); the route re-checks amountPaise ≤ the entry's remaining server-side.

const noteField = z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => {
        if (v == null) return null;
        const t = String(v).trim();
        return t === "" ? null : t.slice(0, 500);
    });

/** Optional ISO date string; the route defaults to "now" when omitted. */
const dateField = z.string().trim().min(1).optional();

const sourceGlLineId = z.number().int().positive();
const amountPaise = z.number().int().positive();

export const costPoolDrawCreateSchema = z.discriminatedUnion("kind", [
    z.object({
        kind: z.literal("ALLOCATION"),
        sourceGlLineId,
        amountPaise,
        productId: z.number().int().positive(),
        perUnitPaise: z.number().int().min(0),
        quantity: z.number().min(0).nullable().optional(),
        note: noteField.optional(),
        date: dateField,
    }),
    z.object({
        kind: z.literal("DISMISSAL"),
        sourceGlLineId,
        amountPaise,
        note: noteField.optional(),
        date: dateField,
    }),
]);

export type CostPoolDrawCreateInput = z.infer<typeof costPoolDrawCreateSchema>;

// Partial update of an existing draw. Kind / source entry / product are fixed
// (delete + re-create to change those). `amountPaise` is re-capped server-side
// against the source entry. perUnit/quantity are ignored on DISMISSAL draws.
export const costPoolDrawUpdateSchema = z.object({
    amountPaise: z.number().int().positive().optional(),
    perUnitPaise: z.number().int().min(0).nullable().optional(),
    quantity: z.number().min(0).nullable().optional(),
    note: noteField.optional(),
});

export type CostPoolDrawUpdateInput = z.infer<typeof costPoolDrawUpdateSchema>;

// Batch ALLOCATION — spread one pool entry's freight across the product lines of
// a purchase/GRN voucher. One CostPoolDraw (kind ALLOCATION) per line. The route
// caps the SUM of amountPaise against the entry's remaining.
export const costPoolAllocateBatchSchema = z.object({
    sourceGlLineId: z.number().int().positive(),
    /// The PURCHASE/GRN voucher the freight is being spread from.
    sourceInvVoucherId: z.number().int().positive().optional(),
    date: dateField,
    note: noteField.optional(),
    lines: z
        .array(
            z.object({
                productId: z.number().int().positive(),
                perUnitPaise: z.number().int().min(0),
                quantity: z.number().min(0).nullable().optional(),
                amountPaise: z.number().int().positive(),
            }),
        )
        .min(1),
});

export type CostPoolAllocateBatchInput = z.infer<typeof costPoolAllocateBatchSchema>;
