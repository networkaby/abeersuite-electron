import { z } from "zod";

// Issue a gift card. The server posts Dr <paymentAccount> / Cr "Gift Card
// Liability" for initialValue. code is auto-generated when omitted.
export const giftCardIssueSchema = z.object({
    code:             z.string().trim().min(3).max(40).optional(),
    initialValue:     z.number().positive().max(100_000_000),
    ownerAccountId:   z.number().int().positive().nullable().optional(),
    expiresAt:        z.coerce.date().nullable().optional(),
    /// Ledger the cash/settlement was received into (Dr). Defaults to "Cash".
    paymentAccountId: z.number().int().positive().nullable().optional(),
});
export type GiftCardIssueInput = z.infer<typeof giftCardIssueSchema>;
