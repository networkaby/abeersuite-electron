// Credit-card-ledger particulars (ledgers under the "Credit Card" group).
// Mirrors bankParticulars.ts's shape/pattern. `limit` (the sanctioned credit
// limit) is optional and purely informational — drives the "Available" hint
// in facilityLimit.ts, same as the Bank OD A/c limit.

import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";

export type CreditCardFields = {
    bankName: string;
    cardNetwork: string;
    cardNumber: string;
    billingDay: string;
    dueDay: string;
    limit: string;
    // Usable Fund fields — all optional.
    // fundTier: "" (default) reads as OTHER — a card's headroom needs a
    // conversion step before it's spendable, unlike a bank balance.
    fundTier: string;
    // convertibility: "" (default) reads as CONVERTIBLE — set to "RESTRICTED"
    // or "UNAVAILABLE" for a card whose headroom has no practical route to cash.
    convertibility: string;
    // Processing fee % applied when convertibility is CONVERTIBLE. See
    // fundTierOf() / netFundValue() in facilityLimit.ts for the resolved value.
    feePct: string;
    // Set ONLY when this card shares its sanctioned limit with one or more
    // other cards (e.g. a primary + add-on card issued under one combined
    // limit) — same arbitrary string on every card in the family, e.g.
    // "hdfc-regalia-family". "" (default) = this card has its own limit,
    // not shared with anything. See netFundTotal() in facilityLimit.ts —
    // summing accountLimit()/availableBalance() per card WITHOUT this key
    // double-counts the one shared limit once per card.
    sharedLimitKey: string;
};

export const EMPTY_CREDIT_CARD: CreditCardFields = {
    bankName: "", cardNetwork: "", cardNumber: "", billingDay: "", dueDay: "", limit: "",
    fundTier: "", convertibility: "", feePct: "", sharedLimitKey: "",
};

export const hasCreditCardData = (c: CreditCardFields): boolean =>
    !!(c.bankName || c.cardNetwork || c.cardNumber || c.billingDay || c.dueDay || c.limit
        || c.fundTier || c.convertibility || c.feePct || c.sharedLimitKey);

export function parseCreditCard(v: unknown): CreditCardFields {
    if (v == null || typeof v !== "object" || Array.isArray(v)) return { ...EMPTY_CREDIT_CARD };
    const o = v as Record<string, unknown>;
    const s = (x: unknown): string => (typeof x === "string" ? x : "");
    return {
        bankName: s(o.bankName),
        cardNetwork: s(o.cardNetwork),
        cardNumber: s(o.cardNumber),
        billingDay: s(o.billingDay),
        dueDay: s(o.dueDay),
        limit: s(o.limit),
        fundTier: s(o.fundTier),
        convertibility: s(o.convertibility),
        feePct: s(o.feePct),
        sharedLimitKey: s(o.sharedLimitKey),
    };
}

// `fundTier` gets its own Select control wherever this list is rendered (see
// the "Usable Fund Tier" block next to it) — a two-state toggle doesn't fit
// the plain-text-input shape below. `convertibility` / `feePct` have no
// control yet — they keep their safe defaults (CONVERTIBLE, no fee) until a
// need to edit them from the UI comes up.
export const CREDIT_CARD_FIELD_LABELS: { key: keyof CreditCardFields; label: string; placeholder: string }[] = [
    { key: "bankName", label: "Issuing Bank", placeholder: "HDFC Bank" },
    { key: "cardNetwork", label: "Card Network", placeholder: "Visa / Mastercard / RuPay" },
    { key: "cardNumber", label: "Card Number (last 4)", placeholder: "4321" },
    { key: "billingDay", label: "Billing Day", placeholder: "5" },
    { key: "dueDay", label: "Due Day", placeholder: "20" },
    { key: "limit", label: "Credit Limit (₹)", placeholder: "100000" },
    {
        key: "sharedLimitKey",
        label: "Shared Limit Key",
        placeholder: "e.g. hdfc-regalia-family — leave blank if not shared",
    },
];

export const isCreditCardGroupName = (name?: string | null): boolean => name === ACCOUNT_GROUPS.CREDIT_CARD;
