// Wallet-ledger particulars (ledgers under the "Wallets" group). Mirrors
// creditCardParticulars.ts's shape/pattern, minus `limit` — a wallet is a
// prepaid balance, not a credit facility, so there's no "Available" hint to
// compute here.

import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";

export type WalletFields = {
    provider: string;
    // Usable Fund fields — all optional.
    // fundTier: "" (default) reads as OTHER — a wallet balance normally
    // needs its own resolution before it's spendable, unlike a bank balance.
    fundTier: string;
    // convertibility: "" (default) reads as CONVERTIBLE. Set to "RESTRICTED"
    // or "UNAVAILABLE" for a wallet whose balance has no practical route to
    // cash (e.g. a closed-loop wallet).
    convertibility: string;
    // Processing fee % applied when convertibility is CONVERTIBLE. See
    // fundTierOf() / netFundValue() in facilityLimit.ts for the resolved value.
    feePct: string;
};

export const EMPTY_WALLET: WalletFields = {
    provider: "", fundTier: "", convertibility: "", feePct: "",
};

export const hasWalletData = (w: WalletFields): boolean =>
    !!(w.provider || w.fundTier || w.convertibility || w.feePct);

export function parseWallet(v: unknown): WalletFields {
    if (v == null || typeof v !== "object" || Array.isArray(v)) return { ...EMPTY_WALLET };
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
export const WALLET_FIELD_LABELS: { key: keyof Omit<WalletFields, "fundTier" | "convertibility" | "feePct">; label: string; placeholder: string }[] = [
    { key: "provider", label: "Provider", placeholder: "Paytm Business / PhonePe Merchant" },
];

export const isWalletGroupName = (name?: string | null): boolean => name === ACCOUNT_GROUPS.WALLETS;
