// Pure registry of payment-gateway providers (Razorpay, Cashfree, manual UPI, …).
// No DB, no React, no process.env — safe to import from both server routes and
// client components (mirrors counterTenders.ts / paymentLink.ts). Deliberately
// extensible: a new provider (PayU, PayPal) drops in by appending to
// PAYMENT_GATEWAY_PROVIDERS — no schema migration, no UI change.
//
// SECRETS NEVER LIVE HERE OR IN THE DB. Each provider only *declares* the names
// of the env vars it needs; the actual presence check runs server-side in
// src/shared/lib/payments/credentialStatus.ts and returns booleans, never values.
//
// This is a different concern from paymentLink.ts (PAYMENT_LINK_PROVIDERS), which
// builds a shareable "please pay ₹X" link/QR. This module is the *catalog* of
// configured gateways used by Settings → Payment Methods, counters, and online.

/// A non-secret config field a provider needs the operator to fill in the UI
/// (e.g. a manual UPI VPA). NEVER use this for keys/secrets — those stay in env.
export type GatewayConfigFieldDescriptor = {
    /** Key under PaymentGateway.configJson. */
    key: string;
    /** Field label shown in the form. */
    label: string;
    /** Render/validation hint. "vpa" validates a `name@bank` UPI id; "text" is free text. */
    kind: "text" | "vpa";
    required: boolean;
    placeholder?: string;
    /** Marker so a reviewer can grep that config fields are never secret. */
    secret: false;
};

export type GatewayEnvironment = "TEST" | "LIVE";

export type PaymentGatewayProvider = {
    /** Registry key stored in PaymentGateway.provider. Stable, lowercase. */
    id: string;
    label: string;
    /** GATEWAY = online API-backed (needs env keys); MANUAL = hand-collected rail. */
    kind: "GATEWAY" | "MANUAL";
    /** Env var names this provider needs, per environment. Used only for ✓/✗ presence. */
    envVars: { test: string[]; live: string[] };
    /** Can be the active online-checkout gateway. */
    supportsOnline: boolean;
    /** Can be picked as a counter collection rail. */
    supportsCounter: boolean;
    /** Non-secret operator-entered fields. */
    configFields: GatewayConfigFieldDescriptor[];
    /** False → provider not wired yet; the UI may still let it be cataloged but flags it. */
    available: boolean;
};

export const razorpayProvider: PaymentGatewayProvider = {
    id: "razorpay",
    label: "Razorpay",
    kind: "GATEWAY",
    envVars: {
        test: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"],
        live: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"],
    },
    supportsOnline: true,
    supportsCounter: true,
    configFields: [],
    available: true,
};

export const cashfreeProvider: PaymentGatewayProvider = {
    id: "cashfree",
    label: "Cashfree",
    kind: "GATEWAY",
    envVars: {
        test: ["CASHFREE_APP_ID", "CASHFREE_SECRET_KEY"],
        live: ["CASHFREE_APP_ID", "CASHFREE_SECRET_KEY"],
    },
    supportsOnline: true,
    supportsCounter: true,
    configFields: [],
    available: true,
};

export const manualUpiProvider: PaymentGatewayProvider = {
    id: "manual_upi",
    label: "Generic UPI / manual",
    kind: "MANUAL",
    envVars: { test: [], live: [] },
    supportsOnline: false,
    supportsCounter: true,
    configFields: [
        {
            key: "vpa",
            label: "UPI ID (VPA)",
            kind: "vpa",
            required: true,
            placeholder: "shop@okhdfcbank",
            secret: false,
        },
    ],
    available: true,
};

/// All known providers, in display order. Append PayU / PayPal here later — no
/// migration needed (PaymentGateway.provider is a plain string keyed to this list).
export const PAYMENT_GATEWAY_PROVIDERS: PaymentGatewayProvider[] = [
    razorpayProvider,
    cashfreeProvider,
    manualUpiProvider,
];

export const GATEWAY_PROVIDER_IDS: string[] = PAYMENT_GATEWAY_PROVIDERS.map((p) => p.id);

export function getGatewayProvider(id: string): PaymentGatewayProvider | undefined {
    return PAYMENT_GATEWAY_PROVIDERS.find((p) => p.id === id);
}

/// The env var names a provider needs for the given environment (TEST/LIVE).
export function envVarsFor(provider: PaymentGatewayProvider, env: GatewayEnvironment): string[] {
    return env === "LIVE" ? provider.envVars.live : provider.envVars.test;
}

/// Validate a `name@bank` UPI id (VPA). Mirrors the lightweight check used at the
/// counter — exact bank handles aren't enumerable, so this stays permissive.
export function isValidVpa(value: string): boolean {
    return /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.]{1,64}$/.test(value.trim());
}

/// Validate the non-secret configJson against a provider's declared config fields.
/// Returns an error message, or null when valid. Pure — shared by POST and PATCH.
export function validateGatewayConfigJson(
    providerId: string,
    configJson: Record<string, unknown>,
): string | null {
    const provider = getGatewayProvider(providerId);
    if (!provider) return "Unknown payment provider";
    for (const field of provider.configFields) {
        const raw = configJson[field.key];
        const value = typeof raw === "string" ? raw.trim() : "";
        if (field.required && !value) return `${field.label} is required`;
        if (value && field.kind === "vpa" && !isValidVpa(value)) {
            return `${field.label} must be a valid UPI ID (name@bank)`;
        }
    }
    return null;
}
