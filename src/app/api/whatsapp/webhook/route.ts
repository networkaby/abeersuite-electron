import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { publishChangeServer } from "@/shared/lib/realtime/serverPublish";
import { applyStatuses, ingestInbound, type WaChangeValue } from "@/modules/message/lib/customerMessages";

/**
 * Meta WhatsApp webhook — customer replies and delivered / read ticks.
 *
 * Registered in the Meta app (WhatsApp → Configuration) as
 *   https://<office-domain>/api/whatsapp/webhook   subscribed to `messages`.
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
    const expected = process.env.META_WA_VERIFY_TOKEN;
    if (expected && sp.get("hub.mode") === "subscribe" && sp.get("hub.verify_token") === expected) {
        return new Response(sp.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return new Response("forbidden", { status: 403 });
}

/** True when the body carries Meta's signature for our app secret. Unset secret
 *  is accepted only outside production, so a dev box can post sample payloads. */
function verifyWebhookSignature(raw: string, header: string | null): boolean {
    const secret = process.env.META_WA_APP_SECRET;
    if (!secret) return process.env.NODE_ENV !== "production";
    if (!header?.startsWith("sha256=")) return false;
    const want = Buffer.from(createHmac("sha256", secret).update(raw, "utf8").digest("hex"));
    const got = Buffer.from(header.slice("sha256=".length));
    return want.length === got.length && timingSafeEqual(want, got);
}

type WebhookBody = { object?: string; entry?: { changes?: { field?: string; value?: WaChangeValue }[] }[] };

export async function POST(req: Request) {
    const raw = await req.text();
    if (!verifyWebhookSignature(raw, req.headers.get("x-hub-signature-256"))) {
        return NextResponse.json({ error: "bad signature" }, { status: 401 });
    }
    let body: WebhookBody;
    try {
        body = JSON.parse(raw) as WebhookBody;
    } catch {
        return NextResponse.json({ error: "bad json" }, { status: 400 });
    }

    let changed = false;
    for (const entry of body.entry ?? []) {
        for (const change of entry.changes ?? []) {
            if (change.field !== "messages" || !change.value) continue;
            try {
                if (await ingestInbound(change.value)) changed = true;
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
    return NextResponse.json({ ok: true });
}
