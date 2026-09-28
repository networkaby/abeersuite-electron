// SERVER-ONLY. Reads process.env to report whether a payment provider's required
// env vars are present — booleans only, NEVER the values. Kept separate from the
// client-safe registry (src/modules/pos/lib/paymentGateways.ts) because it touches
// process.env. Do not import this from a client component.

import {
    getGatewayProvider,
    envVarsFor,
    type GatewayEnvironment,
    type PaymentGatewayProvider,
} from "@/modules/pos/lib/paymentGateways";

export type EnvVarStatus = { name: string; present: boolean };

export type GatewayCredentialStatus = {
    provider: string;
    environment: GatewayEnvironment;
    /** Per env var: its name + whether it's set. Values are never included. */
    vars: EnvVarStatus[];
    /** True when every required env var is present (always true when none required). */
    ready: boolean;
    /** True inside the desktop app, which never carries payment keys (`counterEnv.ts`):
     *  presence measured there says nothing about the office website, where they live. */
    checkedOnOffice: boolean;
};

function statusForNames(names: string[]): EnvVarStatus[] {
    return names.map((name) => ({
        name,
        // Presence = a non-empty trimmed value. We never read or return the value.
        present: Boolean(process.env[name]?.trim()),
    }));
}

/// Credential status for a known provider in a given environment.
export function credentialStatusFor(
    providerId: string,
    environment: GatewayEnvironment,
): GatewayCredentialStatus {
    const provider = getGatewayProvider(providerId);
    const names = provider ? envVarsFor(provider, environment) : [];
    const vars = statusForNames(names);
    return {
        provider: providerId,
        environment,
        vars,
        ready: vars.every((v) => v.present),
        // COUNTER_MACHINE_ID is set by electron/main.ts on every desktop run, never on Vercel.
        checkedOnOffice: Boolean(process.env.COUNTER_MACHINE_ID),
    };
}

/// Credential status for every registered provider, both environments. Used by the
/// Settings form to render ✓/✗ without leaking any secret values.
export function credentialStatusForAll(
    providers: PaymentGatewayProvider[],
): Record<string, { test: GatewayCredentialStatus; live: GatewayCredentialStatus }> {
    const out: Record<string, { test: GatewayCredentialStatus; live: GatewayCredentialStatus }> = {};
    for (const p of providers) {
        out[p.id] = {
            test: credentialStatusFor(p.id, "TEST"),
            live: credentialStatusFor(p.id, "LIVE"),
        };
    }
    return out;
}
