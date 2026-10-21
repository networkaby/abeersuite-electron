import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, parseIdParam } from "@/shared/lib/api";
import { aiErrorMessage, aiStatus, callModel, invalidateAiSetup, keyValue, loadAiSetup, whyNotUsable } from "@/shared/lib/ai/aiKeys";

// POST /api/settings/ai-keys/[id]/test — one tiny call on this key, from THIS
// server (never relayed: an .env or this-PC key may work here and not at the
// office). Runs even while the key is resting; spends one request of its quota.

const TEST_TIMEOUT_MS = 30_000;

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
            const reply = await callModel(key, apiKey, [{ role: "user", content: "Reply with the single word OK." }], {
                signal: AbortSignal.timeout(Math.min(TEST_TIMEOUT_MS, key.timeoutSeconds * 1000)),
            });
            return NextResponse.json({ ok: true, message: `Works — answered "${reply.text.trim().slice(0, 40)}" in ${((Date.now() - started) / 1000).toFixed(1)} s` });
        } catch (e) {
            const status = aiStatus(e);
            const base = aiErrorMessage(e) ?? (e instanceof Error ? e.message : String(e)).slice(0, 200);
            return NextResponse.json({ ok: false, message: status === 404 ? `Model "${key.model}" not found for this key` : base });
        }
    } catch (e) {
        return handleApiError(e, "Test failed");
    }
}
