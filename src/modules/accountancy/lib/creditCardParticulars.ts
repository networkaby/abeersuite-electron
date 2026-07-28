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
};

export const EMPTY_CREDIT_CARD: CreditCardFields = {
    bankName: "", cardNetwork: "", cardNumber: "", billingDay: "", dueDay: "", limit: "",
};

export const hasCreditCardData = (c: CreditCardFields): boolean =>
    !!(c.bankName || c.cardNetwork || c.cardNumber || c.billingDay || c.dueDay || c.limit);

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
    };
}

export const CREDIT_CARD_FIELD_LABELS: { key: keyof CreditCardFields; label: string; placeholder: string }[] = [
    { key: "bankName", label: "Issuing Bank", placeholder: "HDFC Bank" },
    { key: "cardNetwork", label: "Card Network", placeholder: "Visa / Mastercard / RuPay" },
    { key: "cardNumber", label: "Card Number (last 4)", placeholder: "4321" },
    { key: "billingDay", label: "Billing Day", placeholder: "5" },
    { key: "dueDay", label: "Due Day", placeholder: "20" },
    { key: "limit", label: "Credit Limit (₹)", placeholder: "100000" },
];

export const isCreditCardGroupName = (name?: string | null): boolean => name === ACCOUNT_GROUPS.CREDIT_CARD;
