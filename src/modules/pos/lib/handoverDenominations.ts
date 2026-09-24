import { z } from "zod";

// ── A's note/coin tally, carried on the handover for B to check ──────────────
// Client-safe: the close-shift dialog builds it, the takeover modal reads it.

export const handoverDenominationsSchema = z.object({
    lines: z.array(z.object({
        denom: z.number().positive(),
        count: z.number().int().min(0),
    })).max(40),
    otherPaise: z.number().int().min(0),
});

export type HandoverDenominations = z.infer<typeof handoverDenominationsSchema>;

/** The stored JSON, or null when absent or not in this shape (never throws). */
export function parseHandoverDenominations(json: unknown): HandoverDenominations | null {
    const parsed = handoverDenominationsSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
}
