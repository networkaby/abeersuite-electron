// BNPL-ledger particulars (ledgers under the "BNPL A/c" group). Mirrors
// creditCardParticulars.ts's shape/pattern. `limit` (the sanctioned facility
// limit) is optional and purely informational — drives the "Available" hint
// in facilityLimit.ts, same as the Bank OD A/c / Credit Card limits.

import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";

export type BnplFields = {
    provider: string;
    limit: string;
    // Repayment window per purchase, in days — NOT a fixed monthly due date
    // like a credit card. BNPL bills per transaction: each purchase starts
    // its own N-day clock, so two purchases days apart can fall due days
    // apart too. Purely informational (no schedule is computed from it yet).
    creditDays: string;
    // Usable Fund fields — all optional.
    // fundTier: "" (default) reads as OTHER — a BNPL facility needs its own
    // resolution before it's spendable, unlike a bank balance.
    fundTier: string;
    // convertibility: "" (default) reads as RESTRICTED — a BNPL facility is
    // normally purchase-only (no cash-out route). Set to "CONVERTIBLE" only
    // for a provider that genuinely offers one.
    convertibility: string;
    // Processing fee % applied when convertibility is CONVERTIBLE. See
    // fundTierOf() / netFundValue() in facilityLimit.ts for the resolved value.
    feePct: string;
};

export const EMPTY_BNPL: BnplFields = {
    provider: "", limit: "", creditDays: "", fundTier: "", convertibility: "", feePct: "",
};

export const hasBnplData = (b: BnplFields): boolean =>
    !!(b.provider || b.limit || b.creditDays || b.fundTier || b.convertibility || b.feePct);

export function parseBnpl(v: unknown): BnplFields {
    if (v == null || typeof v !== "object" || Array.isArray(v)) return { ...EMPTY_BNPL };
    const o = v as Record<string, unknown>;
    const s = (x: unknown): string => (typeof x === "string" ? x : "");
    return {
        provider: s(o.provider),
        limit: s(o.limit),
        creditDays: s(o.creditDays),
        fundTier: s(o.fundTier),
        convertibility: s(o.convertibility),
        feePct: s(o.feePct),
    };
}

// `fundTier` gets its own Select control wherever this list is rendered — a
// two-state toggle doesn't fit the plain-text-input shape below.
// `convertibility` / `feePct` have no control yet — they keep their safe
// defaults (RESTRICTED, no fee) until a need to edit them from the UI comes up.
export const BNPL_FIELD_LABELS: { key: keyof Omit<BnplFields, "fundTier" | "convertibility" | "feePct">; label: string; placeholder: string }[] = [
    { key: "provider", label: "Provider", placeholder: "Amazon Pay Later / Flipkart Pay Later" },
    { key: "limit", label: "Facility Limit (₹)", placeholder: "60000" },
    { key: "creditDays", label: "Credit Days (per purchase)", placeholder: "e.g. 15" },
];

export const isBnplGroupName = (name?: string | null): boolean => name === ACCOUNT_GROUPS.BNPL;
