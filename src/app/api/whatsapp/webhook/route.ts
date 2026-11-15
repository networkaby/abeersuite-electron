import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, after } from "next/server";
import { pushInboundToStaff, type InboundForPush } from "@/shared/lib/push/staffPush";
import { publishChangeServer } from "@/shared/lib/realtime/serverPublish";
import { applyStatuses, ingestEchoes, ingestInbound, type WaChangeValue } from "@/modules/message/lib/customerMessages";
import { incomingSecret } from "@/modules/incoming/lib/incomingApi";

/**
 * Meta WhatsApp webhook — customer replies and delivered / read ticks.
 *
 * Registered in the Meta app (WhatsApp → Configuration) as
 *   https://<office-domain>/api/whatsapp/webhook   subscribed to `messages` and `smb_message_echoes` (phone-app sends on a coexistence number).
 *
 *   META_WA_VERIFY_TOKEN   any string; typed into Meta's form, echoed back on GET
 *   META_WA_APP_SECRET     Meta app → Settings → Basic → App secret; signs each POST
 *
 * No staff session — Meta posts straight here, the way the PBX bridge posts to
 * /api/calls — so the signature is the gate. Meta retries until it gets a 200,
 * so we answer 200 even when one message fails, and the store skips repeats.
 */

export async function GET(req: Request) {
    const sp = new URL(req.url).searchParams;
    // META_WA_VERIFY_TOKEN, or the verify token on Settings → Incoming API.
    const { value: expected } = await incomingSecret("META_WA_VERIFY");
    if (expected && sp.get("hub.mode") === "subscribe" && sp.get("hub.verify_token") === expected) {
        return new Response(sp.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return new Response("forbidden", { status: 403 });
}

/** True when the body carries Meta's signature for our app secret. Unset secret
 *  is accepted only outside production, so a dev box can post sample payloads. */
async function verifyWebhookSignature(raw: string, header: string | null): Promise<boolean> {
    const { value: secret, enabled } = await incomingSecret("META_WA_APP");
    if (!enabled) return false;
    if (!secret) return process.env.NODE_ENV !== "production";
    if (!header?.startsWith("sha256=")) return false;
    const want = Buffer.from(createHmac("sha256", secret).update(raw, "utf8").digest("hex"));
    const got = Buffer.from(header.slice("sha256=".length));
    return want.length === got.length && timingSafeEqual(want, got);
}

type WebhookBody = { object?: string; entry?: { changes?: { field?: string; value?: WaChangeValue }[] }[] };

export async function POST(req: Request) {
    const raw = await req.text();
    if (!(await verifyWebhookSignature(raw, req.headers.get("x-hub-signature-256")))) {
        return NextResponse.json({ error: "bad signature" }, { status: 401 });
    }
    let body: WebhookBody;
    try {
        body = JSON.parse(raw) as WebhookBody;
    } catch {
        return NextResponse.json({ error: "bad json" }, { status: 400 });
    }

    let changed = false;
    const fresh: InboundForPush[] = [];
    for (const entry of body.entry ?? []) {
        for (const change of entry.changes ?? []) {
            if (!change.value) continue;
            // What staff typed in the WhatsApp Business app (coexistence number).
            if (change.field === "smb_message_echoes") {
                try {
                    if (await ingestEchoes(change.value)) changed = true;
                } catch (e) {
                    console.error("[whatsapp-webhook] echo failed", e);
                }
                continue;
            }
            if (change.field !== "messages") continue;
            try {
                if (await ingestInbound(change.value, (m) => fresh.push(m))) changed = true;
                if (change.value.statuses?.length) {
                    await applyStatuses(change.value);
                    changed = true;
                }
            } catch (e) {
                console.error("[whatsapp-webhook] change failed", e);
            }
        }
    }
    if (changed) void publishChangeServer(["messages"]);
    // Staff phones with the app closed (the open app has the popup).
    if (fresh.length) after(() => pushInboundToStaff(fresh));
    return NextResponse.json({ ok: true });
}
