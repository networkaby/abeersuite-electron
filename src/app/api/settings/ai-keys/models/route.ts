import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { AI_PROVIDERS, aiProviderInfo } from "@/shared/lib/constants/ai";
import { keyValue, loadAiSetup } from "@/shared/lib/ai/aiKeys";

// POST /api/settings/ai-keys/models — asks the provider which models this key
// can use, for the Model box's list. Key: the one pasted in the dialog, else
// the .env variable named there, else the saved key (edit). Costs no AI quota.

const LIST_TIMEOUT_MS = 15_000;

const bodySchema = z.object({
    provider: z.enum(AI_PROVIDERS.map((p) => p.value) as [string, ...string[]]),
    apiKey: z.string().trim().optional(),
    source: z.enum(["db", "env", "ini"]),
    envName: z.string().trim().optional(),
    keyId: z.number().int().positive().optional(),
});

/** Model ids from the provider's own list endpoint, newest names first. */
async function listModels(provider: string, apiKey: string): Promise<string[]> {
    const signal = AbortSignal.timeout(LIST_TIMEOUT_MS);
    const get = async (url: string, headers: Record<string, string>) => {
        const res = await fetch(url, { headers, signal, cache: "no-store" });
        if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
        return res.json() as Promise<unknown>;
    };
    if (provider === "gemini") {
        const body = await get(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000`, { "x-goog-api-key": apiKey }) as
            { models?: { name: string; supportedGenerationMethods?: string[] }[] };
        return (body.models ?? [])
            .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
            .map((m) => m.name.replace(/^models\//, ""));
    }
    if (provider === "claude") {
        const body = await get("https://api.anthropic.com/v1/models?limit=1000", { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }) as { data?: { id: string }[] };
        return (body.data ?? []).map((m) => m.id);
    }
    // OpenAI and every OpenAI-compatible provider: GET {base}/models.
    const base = provider === "openai" ? "https://api.openai.com/v1" : aiProviderInfo(provider)?.baseURL;
    if (!base) return [];
    const body = await get(`${base}/models`, { Authorization: `Bearer ${apiKey}` });
    const rows = Array.isArray(body) ? body : ((body as { data?: unknown[] }).data ?? []); // Together returns a bare array
    return (rows as { id?: string }[]).map((m) => m.id ?? "").filter(Boolean);
}

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_AI_MANAGE);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, bodySchema);
        if (error) return error;
        let apiKey = data.apiKey || null;
        if (!apiKey && data.source === "env") apiKey = (data.envName && process.env[data.envName]?.trim()) || null;
        if (!apiKey && data.keyId) {
            const saved = (await loadAiSetup()).keys.find((k) => k.id === data.keyId);
            if (saved && saved.source === data.source) apiKey = keyValue(saved);
        }
        if (!apiKey) return NextResponse.json({ error: "Paste the key first (or name a .env variable that is set here)." }, { status: 400 });
        try {
            const models = [...new Set(await listModels(data.provider, apiKey))].sort((a, b) => b.localeCompare(a));
            return NextResponse.json({ models });
        } catch (e) {
            return NextResponse.json({ error: `Provider refused the list — ${(e instanceof Error ? e.message : String(e)).slice(0, 240)}` }, { status: 502 });
        }
    } catch (e) {
        return handleApiError(e, "Could not load models");
    }
}
