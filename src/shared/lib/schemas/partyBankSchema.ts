// Request-side validation for the party's own bank account (Person.bankJson /
// Company.bankJson). Shared by PUT /api/person/[id] and PUT /api/companies/[id]
// so the two can never drift — the field shape itself lives in
// shared/lib/parties/partyBank.ts.

import { z } from "zod";
import {
    parsePartyBank, hasPartyBankData, isValidIfsc, isValidVpa,
    type PartyBankFields,
} from "@/shared/lib/parties/partyBank";

const txt = (max: number) => z.string().trim().max(max).optional();

/** The wire shape. Every field optional — the client may send a partial bag,
 *  and `null` explicitly clears the whole account. */
export const partyBankSchema = z.object({
    beneficiary:   txt(120),
    bankName:      txt(120),
    branch:        txt(120),
    accountNumber: txt(34),   // longest IBAN; Indian A/C numbers are far shorter
    ifsc:          txt(11),
    upiVpa:        txt(120),
});

export type PartyBankInput = z.infer<typeof partyBankSchema>;

/**
 * Turn a validated payload into what Prisma should store:
 *   • `null`   → write DbNull (no bank on file), for an absent or all-blank bag
 *   • object   → the normalised six-field bag
 * Returns an `error` string instead when a value is malformed, so the route can
 * answer 400 with a sentence the user can act on.
 */
export function resolvePartyBank(
    input: PartyBankInput | null | undefined,
): { error: string } | { value: PartyBankFields | null } {
    if (!input) return { value: null };

    const bank = parsePartyBank(input);
    if (!isValidIfsc(bank.ifsc)) {
        return { error: `Invalid IFSC "${bank.ifsc}". Expected 4 letters, a 0, then 6 characters — e.g. SBIN0000123.` };
    }
    if (!isValidVpa(bank.upiVpa)) {
        return { error: `Invalid UPI id "${bank.upiVpa}". Expected something like party@okhdfcbank.` };
    }
    return { value: hasPartyBankData(bank) ? bank : null };
}
