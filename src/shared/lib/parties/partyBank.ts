/**
 * The PARTY's own bank account — how we pay a supplier or refund a customer.
 *
 * Not to be confused with:
 *   • `COMPANY_DETAILS.bank` — OUR shop's bank, printed on vouchers so the
 *     customer can pay US (see organisationView.ts / mergeTemplateWithOrg.ts).
 *   • `Account.bankJson` — particulars of a bank LEDGER in the chart of
 *     accounts (carries `limit` / `fundTier`, printed on the deposit slip).
 *
 * Stored as one JSON column on Person and Company so a new field never costs a
 * migration. Every value is a plain trimmed string; a fully blank bag means
 * "not captured" and the API writes NULL rather than a row of empty strings.
 *
 * The parser is deliberately total — it never throws on a malformed column, it
 * just yields blanks, because a bad row must not take down the customer screen.
 */

export type PartyBankFields = {
    /** Name exactly as the bank holds it — what NEFT/RTGS beneficiary checks read. */
    beneficiary: string;
    bankName: string;
    branch: string;
    accountNumber: string;
    /** 11-char IFSC, e.g. SBIN0000123. Stored upper-cased. */
    ifsc: string;
    /** UPI id / VPA, e.g. party@okhdfcbank. Drives the scan-to-pay QR. */
    upiVpa: string;
};

export const EMPTY_PARTY_BANK: PartyBankFields = {
    beneficiary: "", bankName: "", branch: "", accountNumber: "", ifsc: "", upiVpa: "",
};

export const PARTY_BANK_KEYS = Object.keys(EMPTY_PARTY_BANK) as (keyof PartyBankFields)[];

/** True when at least one field carries something worth storing. */
export const hasPartyBankData = (b: PartyBankFields): boolean =>
    PARTY_BANK_KEYS.some((k) => !!b[k]);

/** Any stored value → a complete, blank-filled bag. Never throws. */
export function parsePartyBank(v: unknown): PartyBankFields {
    if (v == null || typeof v !== "object" || Array.isArray(v)) return { ...EMPTY_PARTY_BANK };
    const o = v as Record<string, unknown>;
    const s = (x: unknown): string => (typeof x === "string" ? x.trim() : "");
    return {
        beneficiary:   s(o.beneficiary),
        bankName:      s(o.bankName),
        branch:        s(o.branch),
        accountNumber: s(o.accountNumber),
        ifsc:          s(o.ifsc).toUpperCase(),
        upiVpa:        s(o.upiVpa),
    };
}

/** Field order + copy for the Bank tab's NEFT/RTGS block. UPI is rendered
 *  separately (it owns the QR), so it is not in this list. */
export const PARTY_BANK_FIELDS: {
    key: Exclude<keyof PartyBankFields, "upiVpa">;
    label: string;
    placeholder: string;
    /** Show a copy-to-clipboard button — the values staff paste into net-banking. */
    copyable?: boolean;
}[] = [
    { key: "beneficiary",   label: "Account holder’s name", placeholder: "Name as per bank" },
    { key: "bankName",      label: "Bank Name",             placeholder: "State Bank of India" },
    { key: "branch",        label: "Branch",                placeholder: "Fancy Bazar" },
    { key: "accountNumber", label: "A/C No",                placeholder: "38124567890", copyable: true },
    { key: "ifsc",          label: "IFSC",                  placeholder: "SBIN0000123", copyable: true },
];

/** Indian IFSC: 4 letters + "0" + 6 alphanumerics. Blank passes (optional field). */
export const isValidIfsc = (v: string): boolean =>
    v === "" || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v.toUpperCase());

/** A UPI id is `handle@psp`; both halves non-empty, no spaces. Blank passes. */
export const isValidVpa = (v: string): boolean =>
    v === "" || /^[\w.\-]{2,}@[A-Za-z]{2,}$/.test(v);

/**
 * `upi://pay` deep link for the party's scan-to-pay QR, or "" when there is no
 * VPA to encode (the caller hides the QR on "").
 *
 * Shares its shape with the shop-side `buildUpiPayLink` in organisationView.ts;
 * kept as its own function because the payee name comes from a different place
 * (the party's beneficiary / display name, not the shop's brand).
 */
export function buildPartyUpiLink(bank: PartyBankFields, partyName?: string): string {
    if (!bank.upiVpa) return "";
    const payee = bank.beneficiary || partyName || "";
    const pn = payee ? `&pn=${encodeURIComponent(payee)}` : "";
    return `upi://pay?pa=${encodeURIComponent(bank.upiVpa)}${pn}&cu=INR`;
}
