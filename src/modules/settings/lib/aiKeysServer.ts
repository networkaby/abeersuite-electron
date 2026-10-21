import "server-only";
import { z } from "zod";
import { AI_KEY_SOURCES, AI_PROVIDERS, isWebProvider } from "@/shared/lib/constants/ai";
import { keyUsage, whyNotUsable, type AiKeyConfig } from "@/shared/lib/ai/aiKeys";
import { hasLocalKey } from "@/shared/lib/ai/aiLocalKeys";
import { hasSharedSecret, lockSecret } from "@/shared/lib/ai/secretBox";

// Settings → AI Setup API helpers (routes under /api/settings/ai-keys). A key
// value never leaves the server: the list carries only the last 4 / the name.

const seconds = (max: number) => z.number().int().min(0).max(max);

export const aiKeyBodySchema = z.object({
    name: z.string().trim().min(1).max(80),
    provider: z.enum(AI_PROVIDERS.map((p) => p.value) as [string, ...string[]]),
    /** Empty for a web tool (Exa, Tavily …) — it has no model. */
    model: z.string().trim().max(120),
    source: z.enum(AI_KEY_SOURCES.map((s) => s.value) as [string, ...string[]]),
    /** env: the variable name. */
    envName: z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Variable name: letters, digits and _ only").max(120).nullable().optional(),
    /** db: the pasted key; empty / absent on edit keeps the saved one. Never for ini (saved on the PC). */
    secret: z.string().trim().max(500).optional(),
    /** ini: last 4 of the key the browser is about to save on this PC. */
    keyHint: z.string().trim().max(8).optional(),
    canPhoto: z.boolean(),
    canSearch: z.boolean(),
    paid: z.boolean(),
    active: z.boolean(),
    validTill: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    gapSeconds: seconds(3600),
    dailyLimit: z.number().int().min(1).max(1_000_000).nullable(),
    limitRestSeconds: seconds(24 * 3600),
    failRestSeconds: seconds(24 * 3600),
    timeoutSeconds: z.number().int().min(5).max(600),
    retries: z.number().int().min(0).max(3),
}).refine((b) => isWebProvider(b.provider) || b.model.length > 0, { message: "Model is required", path: ["model"] });
export type AiKeyBody = z.infer<typeof aiKeyBodySchema>;

/** What the setup page gets for one key — usable/why on THIS server, and its counts here. */
export function aiKeyView(k: AiKeyConfig) {
    const { secretEnc: _secret, ...rest } = k;
    return {
        ...rest,
        notUsableHere: whyNotUsable(k),
        onThisPc: k.source === "ini" ? hasLocalKey(k.id) : null,
        usage: keyUsage(k.id),
    };
}

/** Row columns from the form. `prev` = the saved row on edit. */
export function aiKeyRowData(data: AiKeyBody, prev?: { source: string; secretEnc: string | null; keyHint: string }) {
    const base = {
        name: data.name, provider: data.provider, model: data.model, source: data.source,
        canPhoto: data.canPhoto, canSearch: data.canSearch, paid: data.paid, active: data.active,
        validTill: data.validTill ? new Date(`${data.validTill}T00:00:00Z`) : null,
        gapSeconds: data.gapSeconds, dailyLimit: data.dailyLimit, limitRestSeconds: data.limitRestSeconds,
        failRestSeconds: data.failRestSeconds, timeoutSeconds: data.timeoutSeconds, retries: data.retries,
    };
    if (data.source === "env") {
        if (!data.envName) return { error: "Type the .env variable name." };
        return { row: { ...base, envName: data.envName, secretEnc: null, keyHint: data.envName } };
    }
    if (data.source === "db") {
        const secret = data.secret?.trim();
        if (!secret) {
            if (prev?.source === "db" && prev.secretEnc) return { row: { ...base, envName: null } };
            return { error: "Paste the key." };
        }
        if (!hasSharedSecret()) return { error: "AI_KEY_SECRET is not set on this server — keys cannot be saved here." };
        return { row: { ...base, envName: null, secretEnc: lockSecret(secret, "shared"), keyHint: secret.slice(-4) } };
    }
    // ini: the value is saved on the PC by ./[id]/local; only its last 4 come here.
    return { row: { ...base, envName: null, secretEnc: null, keyHint: data.keyHint || (prev?.source === "ini" ? prev.keyHint : "") } };
}
