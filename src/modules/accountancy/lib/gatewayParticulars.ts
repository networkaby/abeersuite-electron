// Payment-gateway-ledger particulars (ledgers under the "Payment Gateway"
// group — already live as a real-config group).
// Mirrors walletParticulars.ts's shape/pattern — no `limit`, a gateway
// balance is a settlement balance, not a credit facility.

import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";

export type GatewayFields = {
    provider: string;
    // Usable Fund fields — all optional.
    // fundTier: "" (default) reads as OTHER — settlement timing varies by
    // provider, so a gateway balance needs its own resolution by default.
    // Set to "INSTANT" for a provider that settles same-day/next-day.
    fundTier: string;
    // convertibility: "" (default) reads as CONVERTIBLE.
    convertibility: string;
    // Processing fee % applied when convertibility is CONVERTIBLE. See
    // fundTierOf() / netFundValue() in facilityLimit.ts for the resolved value.
    feePct: string;
};

export const EMPTY_GATEWAY: GatewayFields = {
    provider: "", fundTier: "", convertibility: "", feePct: "",
};

export const hasGatewayData = (g: GatewayFields): boolean =>
    !!(g.provider || g.fundTier || g.convertibility || g.feePct);

export function parseGateway(v: unknown): GatewayFields {
    if (v == null || typeof v !== "object" || Array.isArray(v)) return { ...EMPTY_GATEWAY };
    const o = v as Record<string, unknown>;
    const s = (x: unknown): string => (typeof x === "string" ? x : "");
    return {
        provider: s(o.provider),
        fundTier: s(o.fundTier),
        convertibility: s(o.convertibility),
        feePct: s(o.feePct),
    };
}

// `fundTier` gets its own Select control wherever this list is rendered — a
// two-state toggle doesn't fit the plain-text-input shape below.
// `convertibility` / `feePct` have no control yet — they keep their safe
// defaults (CONVERTIBLE, no fee) until a need to edit them from the UI comes up.
export const GATEWAY_FIELD_LABELS: { key: keyof Omit<GatewayFields, "fundTier" | "convertibility" | "feePct">; label: string; placeholder: string }[] = [
    { key: "provider", label: "Provider", placeholder: "Razorpay / Cashfree" },
];

export const isGatewayGroupName = (name?: string | null): boolean => name === ACCOUNT_GROUPS.PAYMENT_GATEWAY;
