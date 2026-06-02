import { z } from "zod";

// Generate a gift card. Creates a DRAFT card — NO GL posting (it's "UI only"
// until sold). code is auto-generated when omitted.
export const giftCardGenerateSchema = z.object({
    code:           z.string().trim().min(3).max(40).optional(),
    initialValue:   z.number().positive().max(100_000_000),
    ownerAccountId: z.number().int().positive().nullable().optional(),
    expiresAt:      z.coerce.date().nullable().optional(),
});
export type GiftCardGenerateInput = z.infer<typeof giftCardGenerateSchema>;

// Edit a card. Content fields (value/code/owner/expiry) are DRAFT-only; `enabled`
// is a no-GL redemption toggle allowed on DRAFT + ACTIVE cards.
export const giftCardUpdateSchema = giftCardGenerateSchema.partial().extend({
    enabled: z.boolean().optional(),
});
export type GiftCardUpdateInput = z.infer<typeof giftCardUpdateSchema>;

// Issue/sell an existing DRAFT card. The server posts Dr <paymentAccount> /
// Cr "Gift Card Liability" for the card's value and flips it to ACTIVE.
export const giftCardIssueSchema = z.object({
    /// Ledger the cash/settlement was received into (Dr). Defaults to "Cash".
    paymentAccountId: z.number().int().positive().nullable().optional(),
});
export type GiftCardIssueInput = z.infer<typeof giftCardIssueSchema>;
