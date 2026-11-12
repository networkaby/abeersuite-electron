// SERVER-ONLY. Reports whether a payment provider's required keys are present —
// in Settings → App Settings or in process.env — booleans only, NEVER the values. Kept separate from the
// client-safe registry (src/modules/pos/lib/paymentGateways.ts) because it touches
// process.env. Do not import this from a client component.

import { appSetting } from "@/shared/lib/settings/appSettings.server";
import { APP_SETTING_DEFS, type AppSettingKey } from "@/shared/lib/constants/appSettings";
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

const APP_SETTING_KEYS = new Set<string>(APP_SETTING_DEFS.map((d) => d.key));

async function statusForNames(names: string[]): Promise<EnvVarStatus[]> {
    return Promise.all(
        names.map(async (name) => ({
            name,
            // Presence = a non-empty value (App Settings first, then .env). Never returned.
            present: APP_SETTING_KEYS.has(name)
                ? Boolean(await appSetting(name as AppSettingKey))
                : Boolean(process.env[name]?.trim()),
        })),
    );
}

/// Credential status for a known provider in a given environment.
export async function credentialStatusFor(
    providerId: string,
    environment: GatewayEnvironment,
): Promise<GatewayCredentialStatus> {
    const provider = getGatewayProvider(providerId);
    const names = provider ? envVarsFor(provider, environment) : [];
    const vars = await statusForNames(names);
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
export async function credentialStatusForAll(
    providers: PaymentGatewayProvider[],
): Promise<Record<string, { test: GatewayCredentialStatus; live: GatewayCredentialStatus }>> {
    const out: Record<string, { test: GatewayCredentialStatus; live: GatewayCredentialStatus }> = {};
    for (const p of providers) {
        out[p.id] = {
            test: await credentialStatusFor(p.id, "TEST"),
            live: await credentialStatusFor(p.id, "LIVE"),
        };
    }
    return out;
}
