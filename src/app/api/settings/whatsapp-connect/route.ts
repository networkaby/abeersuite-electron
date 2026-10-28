import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { META_APP_ID } from "@/shared/lib/constants/whatsapp";
import { incomingSecret } from "@/modules/incoming/lib/incomingApi";

/**
 * POST /api/settings/whatsapp-connect — finish Meta's Embedded Signup for a
 * number that stays on the WhatsApp Business app (coexistence).
 *
 * The browser popup hands back a one-time `code` plus the new number's
 * phone_number_id and waba_id. Here we swap the code for a business token,
 * subscribe our app to that WABA (so its messages reach /api/whatsapp/webhook)
 * and ask Meta to copy the app's contacts and chat history — Meta allows that
 * only in the first 24 hours after onboarding, so it is done right away.
 *
 *   META_APP_ID               constants/whatsapp.ts
 *   META_WA_APP_SECRET        same app's secret, already used by the webhook
 */
const GRAPH = "https://graph.facebook.com/v23.0";

async function graph(path: string, token: string, body?: Record<string, unknown>) {
    const res = await fetch(`${GRAPH}/${path}`, {
        method: body ? "POST" : "GET",
        headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
    if (!res.ok) throw new Error(json.error?.message || `Meta ${path} failed (${res.status})`);
    return json;
}

export async function POST(req: Request) {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;

    const appId = META_APP_ID;
    const { value: secret } = await incomingSecret("META_WA_APP");
    if (!appId || !secret) return NextResponse.json({ error: "WhatsApp app secret not set — Settings → Incoming API (or META_WA_APP_SECRET)" }, { status: 503 });

    const { code, phoneNumberId, wabaId } = (await req.json().catch(() => ({}))) as { code?: string; phoneNumberId?: string; wabaId?: string };
    if (!code || !phoneNumberId || !wabaId) return NextResponse.json({ error: "code, phoneNumberId and wabaId are required" }, { status: 400 });

    const steps: string[] = [];
    try {
        const tokenUrl = `${GRAPH}/oauth/access_token?client_id=${appId}&client_secret=${secret}&code=${encodeURIComponent(code)}`;
        const tokRes = await fetch(tokenUrl);
        const tok = (await tokRes.json()) as { access_token?: string; error?: { message?: string } };
        if (!tok.access_token) throw new Error(tok.error?.message || "code exchange failed");
        const token = tok.access_token;
        steps.push("token");

        await graph(`${wabaId}/subscribed_apps`, token, {});
        steps.push("webhook subscribed");

        // Coexistence only: copy the app's contacts, then its chat history.
        for (const sync_type of ["smb_app_state_sync", "history"]) {
            try {
                await graph(`${phoneNumberId}/smb_app_data`, token, { messaging_product: "whatsapp", sync_type });
                steps.push(sync_type);
            } catch (e) {
                steps.push(`${sync_type} skipped: ${(e as Error).message}`);
            }
        }

        const info = await graph(`${phoneNumberId}?fields=display_phone_number,verified_name`, token);
        console.info("[whatsapp-connect] onboarded", { phoneNumberId, wabaId, steps });
        return NextResponse.json({ ok: true, phoneNumberId, wabaId, display: info.display_phone_number, name: info.verified_name, steps });
    } catch (e) {
        console.error("[whatsapp-connect] failed", { phoneNumberId, wabaId, steps }, e);
        return NextResponse.json({ error: (e as Error).message, steps }, { status: 502 });
    }
}
