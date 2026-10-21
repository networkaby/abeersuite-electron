import { NextResponse } from "next/server";
import { APICallError, RetryError } from "ai";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, parseIdParam } from "@/shared/lib/api";
import { aiProviderInfo } from "@/shared/lib/constants/ai";
import { readOn, searchOn } from "@/shared/lib/ai/aiWeb";
import { aiErrorMessage, aiStatus, callModel, invalidateAiSetup, keyValue, loadAiSetup, whyNotUsable } from "@/shared/lib/ai/aiKeys";

// POST /api/settings/ai-keys/[id]/test — one tiny call on this key, from THIS
// server (never relayed: an .env or this-PC key may work here and not at the
// office). Runs even while the key is resting; spends one request of its quota.

const TEST_TIMEOUT_MS = 30_000;

/** The provider's error text (Google: error.message in the JSON body), short. */
function providerDetail(e: unknown): string {
    const inner = RetryError.isInstance(e) ? e.lastError : e;
    if (!APICallError.isInstance(inner)) return "";
    try {
        // Google / OpenAI: error.message; Exa, Tavily, Firecrawl: error / message / detail as text.
        const body = JSON.parse(inner.responseBody ?? "") as { error?: string | { message?: string }; message?: string; detail?: unknown };
        const err = typeof body.error === "string" ? body.error : body.error?.message;
        return (err ?? body.message ?? (typeof body.detail === "string" ? body.detail : inner.message)).slice(0, 200);
    } catch {
        return inner.message.slice(0, 200);
    }
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_AI_MANAGE);
    if (response) return response;
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;
    try {
        invalidateAiSetup();
        const key = (await loadAiSetup()).keys.find((k) => k.id === id);
        if (!key) return NextResponse.json({ error: "Key not found" }, { status: 404 });
        // "Turned off" / "Offer ended" still get tested — staff test before switching on.
        const blocker = whyNotUsable({ ...key, active: true, validTill: null });
        const apiKey = keyValue(key);
        if (blocker || !apiKey) return NextResponse.json({ ok: false, message: blocker ?? "No key here" });
        const started = Date.now();
        try {
            const signal = AbortSignal.timeout(Math.min(TEST_TIMEOUT_MS, key.timeoutSeconds * 1000));
            const took = () => `${((Date.now() - started) / 1000).toFixed(1)} s`;
            const info = aiProviderInfo(key.provider);
            if (info?.kind === "web") {
                if (info.searchable) {
                    const pages = await searchOn(key, apiKey, "HP 680 ink cartridge page yield", signal);
                    return NextResponse.json({ ok: pages.length > 0, message: pages.length ? `Works — found ${pages.length} pages in ${took()}` : "Answered, but found no pages" });
                }
                const page = await readOn(key, apiKey, "https://example.com", signal);
                return NextResponse.json({ ok: !!page.text, message: page.text ? `Works — read a page (${page.text.length} characters) in ${took()}` : "Answered, but the page came back empty" });
            }
            const reply = await callModel(key, apiKey, [{ role: "user", content: "Reply with the single word OK." }], { signal });
            return NextResponse.json({ ok: true, message: `Works — answered "${reply.text.trim().slice(0, 40)}" in ${took()}` });
        } catch (e) {
            const status = aiStatus(e);
            const base = aiErrorMessage(e) ?? (e instanceof Error ? e.message : String(e)).slice(0, 200);
            // Staff need the provider's own words here (bad model name vs bad key both come back 400).
            const detail = providerDetail(e);
            const message = status === 404 ? `Model "${key.model}" not found for this key` : base;
            return NextResponse.json({ ok: false, message: detail ? `${message} (${status}: ${detail})` : message });
        }
    } catch (e) {
        return handleApiError(e, "Test failed");
    }
}
