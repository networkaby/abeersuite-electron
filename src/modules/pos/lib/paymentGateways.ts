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

export const payuProvider: PaymentGatewayProvider = {
    id: "payu",
    label: "PayU",
    kind: "GATEWAY",
    envVars: {
        test: ["PAYU_MERCHANT_KEY", "PAYU_MERCHANT_SALT"],
        live: ["PAYU_MERCHANT_KEY", "PAYU_MERCHANT_SALT"],
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

/// Demo online gateway — no real API and no keys. When it's the active online
/// gateway, storefront checkout offers "Pay online (Demo)" and the confirmation
/// page shows a floating "Simulate payment success" button that fires the same
/// success signal a real webhook would (marks the order paid + confirms it). Lets
/// the full paid-order → fulfilment flow be demoed end-to-end without a live PSP.
export const demoProvider: PaymentGatewayProvider = {
    id: "demo",
    label: "Demo gateway (simulate)",
    kind: "GATEWAY",
    envVars: { test: [], live: [] },
    supportsOnline: true,
    supportsCounter: false,
    configFields: [],
    available: true,
};

/// Pay on delivery — OUR OWN "pay later" rail (formerly the hardcoded Cash-on-
/// Delivery button at checkout). No external API, no keys. It is NEITHER the
/// prepaid online gateway (supportsOnline:false → stays out of the ≤1-online-gateway
/// slot) NOR a counter rail (supportsCounter:false). Its checkout availability is
/// driven purely by `isActive` + an area rule stored on configJson.area
/// (see src/shared/lib/payments/payOnDelivery.ts). It's a FIXED singleton: the app
/// self-heals exactly one row and the UI/API forbid adding or deleting it.
export const PAY_ON_DELIVERY_PROVIDER_ID = "pay_on_delivery";

export const payOnDeliveryProvider: PaymentGatewayProvider = {
    id: PAY_ON_DELIVERY_PROVIDER_ID,
    label: "Pay on delivery",
    kind: "MANUAL",
    envVars: { test: [], live: [] },
    supportsOnline: false,
    supportsCounter: false,
    // Area rules use a bespoke editor (states + pincode prefixes + mode), not the
    // simple text/vpa configFields — so none are declared here.
    configFields: [],
    available: true,
};

/// All known providers, in display order. Append PayU / PayPal here later — no
/// migration needed (PaymentGateway.provider is a plain string keyed to this list).
export const PAYMENT_GATEWAY_PROVIDERS: PaymentGatewayProvider[] = [
    payOnDeliveryProvider,
    razorpayProvider,
    payuProvider,
    cashfreeProvider,
    manualUpiProvider,
    demoProvider,
];

export const GATEWAY_PROVIDER_IDS: string[] = PAYMENT_GATEWAY_PROVIDERS.map((p) => p.id);

/**
 * The HARD-CODED payment-method catalog — like the courier catalog, these methods
 * are fixed in code, not user-addable/deletable. The app self-heals one row per
 * entry (create-if-absent by provider); the DB stores only each method's editable
 * config (Active, environment, counter/online flags, POD area rule). A new gateway
 * is added by appending here (and to PAYMENT_GATEWAY_PROVIDERS) — never via the UI.
 *
 * Not every registered provider is in the catalog: the Demo simulator and the
 * generic manual-UPI counter rail stay available to other flows but aren't shown
 * as fixed cards here. Self-heal never overwrites an existing row, so an already-
 * configured method (e.g. Razorpay with its keys) keeps its settings.
 */
export const PAYMENT_METHOD_DEFAULTS: {
    provider: string;
    displayName: string;
    environment: "TEST" | "LIVE";
    enabledForCounter: boolean;
    enabledForOnline: boolean;
    isActive: boolean;
    sortOrder: number;
    configJson: Record<string, unknown>;
}[] = [
    {
        provider: PAY_ON_DELIVERY_PROVIDER_ID,
        displayName: "Pay on delivery",
        environment: "TEST",
        enabledForCounter: false,
        enabledForOnline: false,
        isActive: true, // preserves the old always-on Cash-on-Delivery behaviour
        sortOrder: 0,
        configJson: { area: { mode: "except", states: [], pincodePrefixes: [] } },
    },
    {
        provider: "razorpay",
        displayName: "Razorpay",
        environment: "TEST",
        enabledForCounter: true,
        enabledForOnline: false,
        isActive: false, // activate once the keys are set + the operator turns it on
        sortOrder: 10,
        configJson: {},
    },
    {
        provider: "payu",
        displayName: "PayU",
        environment: "TEST",
        enabledForCounter: true,
        enabledForOnline: false,
        isActive: false,
        sortOrder: 20,
        configJson: {},
    },
    {
        provider: "cashfree",
        displayName: "Cashfree",
        environment: "TEST",
        enabledForCounter: true,
        enabledForOnline: false,
        isActive: false,
        sortOrder: 30,
        configJson: {},
    },
];

export function getGatewayProvider(id: string): PaymentGatewayProvider | undefined {
    return PAYMENT_GATEWAY_PROVIDERS.find((p) => p.id === id);
}

/// The GL settlement ledger a method's collections book into, read off its
/// configJson (`settlementAccountId`). null = not configured — an online gateway
/// without one is UNUSABLE (not offered at checkout) so every payment is bookable.
export function settlementAccountIdOf(configJson: unknown): number | null {
    const v = Number(
        (configJson as { settlementAccountId?: unknown } | null | undefined)?.settlementAccountId,
    );
    return Number.isInteger(v) && v > 0 ? v : null;
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
