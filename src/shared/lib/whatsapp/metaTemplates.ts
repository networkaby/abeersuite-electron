import "server-only";
import QRCode from "qrcode";
import { META_APP_ID, WA_CONVERSATION_NUMBER_ID } from "@/shared/lib/constants/whatsapp";
import {
    WA_APP_LINK,
    WA_BILL_LINK_BASE,
    WA_CALL_BUTTON,
    bodyFieldOrder,
    hasImageHeader,
    sampleValuesFor,
    toMetaBody,
    type WaFieldValues,
    type WaTemplateDraft,
    type WaTemplateKind,
} from "./billTemplates";

/**
 * Meta Cloud API calls for the bill / receipt templates: submit a template for
 * approval, read its approval status, and send a bill with it.
 *
 * Same Meta account and token as the OTP sender (sendWhatsApp.ts). Templates
 * belong to the WhatsApp Business Account, not the phone number, hence:
 *   META_WA_BUSINESS_ACCOUNT_ID   WABA id, Meta dashboard → WhatsApp → API setup
 * The token needs `whatsapp_business_management` (templates) as well as
 * `whatsapp_business_messaging` (sending).
 *
 * Category is UTILITY: a bill is a transaction message, and Meta charges the
 * utility rate for it. Language is English only (owner, 2026-10-06).
 */

const GRAPH = "https://graph.facebook.com/v21.0";
const LANG = "en";

function token() {
    return process.env.META_WA_ACCESS_TOKEN;
}

export function isTemplateApiConfigured(): boolean {
    return Boolean(token() && process.env.META_WA_BUSINESS_ACCOUNT_ID);
}
export function isBillSendConfigured(): boolean {
    return Boolean(token() && conversationNumberId());
}

/**
 * The number bills, reminders and new replies go out from. OTP stays on
 * META_WA_PHONE_NUMBER_ID (sendWhatsApp.ts); the second, conversation-only
 * number is WA_CONVERSATION_NUMBER_ID in constants/whatsapp.ts.
 */
export function conversationNumberId(): string | undefined {
    return WA_CONVERSATION_NUMBER_ID || process.env.META_WA_PHONE_NUMBER_ID;
}

type GraphError = { error?: { message?: string; error_user_msg?: string } };

/** One Graph call; throws with Meta's own wording on failure. */
async function graph<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const res = await fetch(`${GRAPH}/${path}`, {
        method: init?.method ?? "GET",
        headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
        body: init?.body ? JSON.stringify(init.body) : undefined,
        cache: "no-store",
    });
    const text = await res.text().catch(() => "");
    let json: (T & GraphError) | null = null;
    try {
        json = JSON.parse(text);
    } catch {
        /* non-JSON — handled below */
    }
    if (!res.ok || !json || json.error) {
        const e = json?.error;
        throw new Error(e?.error_user_msg || e?.message || `Meta answered ${res.status}: ${text.slice(0, 200)}`);
    }
    return json;
}

/**
 * Upload a sample picture for a photo-header template. Meta wants a handle from
 * its Resumable Upload API (app-level), not a link, as the header example.
 */
async function uploadHeaderSample(bytes: Uint8Array, mime: string): Promise<string> {
    const session = await graph<{ id: string }>(
        `${META_APP_ID}/uploads?file_length=${bytes.byteLength}&file_type=${encodeURIComponent(mime)}`,
        { method: "POST" },
    );
    const res = await fetch(`${GRAPH}/${session.id}`, {
        method: "POST",
        headers: { Authorization: `OAuth ${token()}`, file_offset: "0" },
        body: Buffer.from(bytes),
        cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as ({ h?: string } & GraphError) | null;
    if (!res.ok || !json?.h) throw new Error(json?.error?.message || `Meta upload failed (${res.status})`);
    return json.h;
}

/** A sample UPI QR for Meta's reviewer — the real one is made per request. */
async function sampleQrPng(): Promise<Uint8Array> {
    const buf = await QRCode.toBuffer("upi://pay?pa=shop@upi&pn=Shop&am=1250.00&cu=INR", { type: "png", width: 640, margin: 4 });
    return new Uint8Array(buf);
}

/** Meta's component list for a draft — optional photo header, body, the
 *  optional URL buttons and a Call us button (last, so the View button
 *  stays index 0 when sending). */
async function components(kind: WaTemplateKind, draft: WaTemplateDraft) {
    const order = bodyFieldOrder(draft.body);
    const samples = sampleValuesFor(kind);
    const list: unknown[] = [];
    if (hasImageHeader(kind)) {
        const handle = await uploadHeaderSample(await sampleQrPng(), "image/png");
        list.push({ type: "HEADER", format: "IMAGE", example: { header_handle: [handle] } });
    }
    list.push(
        {
            type: "BODY",
            text: toMetaBody(draft.body.trim()),
            ...(order.length ? { example: { body_text: [order.map((k) => samples[k])] } } : {}),
        },
    );
    const buttons: unknown[] = [];
    if (draft.viewButton?.trim()) {
        buttons.push({
            type: "URL",
            text: draft.viewButton.trim(),
            url: `${WA_BILL_LINK_BASE}{{1}}`,
            example: [`${WA_BILL_LINK_BASE}1042`],
        });
    }
    if (draft.appButton?.trim()) {
        buttons.push({ type: "URL", text: draft.appButton.trim(), url: WA_APP_LINK });
    }
    if (kind !== "TICKET_AUTO_REPLY") {
        buttons.push({ type: "PHONE_NUMBER", text: WA_CALL_BUTTON.text, phone_number: WA_CALL_BUTTON.phone });
    }
    if (buttons.length) list.push({ type: "BUTTONS", buttons });
    return list;
}

/** Send a draft to Meta for approval. Meta answers PENDING (or sometimes
 *  APPROVED straight away for a clean utility template). */
export async function submitTemplate(kind: WaTemplateKind, name: string, draft: WaTemplateDraft): Promise<{ id: string; status: string }> {
    const r = await graph<{ id: string; status: string }>(
        `${process.env.META_WA_BUSINESS_ACCOUNT_ID}/message_templates`,
        { method: "POST", body: { name, language: LANG, category: "UTILITY", components: await components(kind, draft) } },
    );
    return { id: r.id, status: r.status };
}

export type MetaTemplateStatus = { status: string; rejectReason: string | null } | null;

/** Current approval status of a submitted template; null when Meta has no such name. */
export async function fetchTemplateStatus(name: string): Promise<MetaTemplateStatus> {
    const r = await graph<{ data: { name: string; status: string; rejected_reason?: string }[] }>(
        `${process.env.META_WA_BUSINESS_ACCOUNT_ID}/message_templates?name=${encodeURIComponent(name)}&fields=name,status,rejected_reason`,
    );
    const row = r.data.find((t) => t.name === name);
    if (!row) return null;
    const reason = row.rejected_reason && row.rejected_reason !== "NONE" ? row.rejected_reason : null;
    return { status: row.status, rejectReason: reason };
}

/**
 * Send one bill / receipt with an APPROVED template. `values` fills the body's
 * fields; `linkCode` goes into the View button's URL. Returns Meta's message id.
 */
export async function sendBillTemplate(args: {
    mobile10: string;
    name: string;
    approved: WaTemplateDraft;
    values: WaFieldValues;
    /** Last part of the View button URL: a voucher id, or t<ticketId>. */
    linkCode: string;
    /** Public https link to the photo, for a template with a photo header. */
    headerImage?: string;
}): Promise<string> {
    const order = bodyFieldOrder(args.approved.body);
    const comps: unknown[] = [];
    if (args.headerImage) {
        comps.push({ type: "header", parameters: [{ type: "image", image: { link: args.headerImage } }] });
    }
    if (order.length) {
        comps.push({ type: "body", parameters: order.map((k) => ({ type: "text", text: args.values[k] })) });
    }
    // Only the View button carries a variable; the app button's URL is fixed.
    if (args.approved.viewButton?.trim()) {
        comps.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: args.linkCode }] });
    }
    const r = await graph<{ messages?: { id?: string }[] }>(`${conversationNumberId()}/messages`, {
        method: "POST",
        body: {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: `+91${args.mobile10}`,
            type: "template",
            template: { name: args.name, language: { code: LANG }, components: comps },
        },
    });
    const id = r.messages?.[0]?.id;
    if (!id) throw new Error("Meta accepted the call but returned no message id");
    return id;
}

/**
 * Send a free-text reply. Meta accepts one only inside the 24-hour window that
 * opens when the customer last wrote to us — the caller checks that first
 * (customerMessages.ts `replyWindowOpen`). Returns Meta's message id.
 */
export async function sendTextMessage(mobile10: string, text: string, fromNumberId?: string | null): Promise<string> {
    const r = await graph<{ messages?: { id?: string }[] }>(`${fromNumberId || conversationNumberId()}/messages`, {
        method: "POST",
        body: {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: `+91${mobile10}`,
            type: "text",
            text: { body: text, preview_url: false },
        },
    });
    const id = r.messages?.[0]?.id;
    if (!id) throw new Error("Meta accepted the call but returned no message id");
    return id;
}

export type WaMediaType = "image" | "video" | "audio" | "document";

/** Which WhatsApp message type a file goes out as. Meta takes only JPEG/PNG as
 *  "image" and MP4/3GPP as "video"; anything else is sent as a document. */
export function waMediaTypeFor(mime: string): WaMediaType {
    if (mime === "image/jpeg" || mime === "image/png") return "image";
    if (mime === "video/mp4" || mime === "video/3gpp") return "video";
    if (/^audio\/(aac|amr|mpeg|mp4|ogg)/.test(mime)) return "audio";
    return "document";
}

/**
 * Send a photo / file / voice note / video by link (a short-lived signed R2
 * URL — Meta fetches it at once). Same 24-hour rule as text. Returns Meta's id.
 */
export async function sendMediaMessage(args: {
    mobile10: string;
    link: string;
    mime: string;
    caption?: string | null;
    fileName?: string | null;
    fromNumberId?: string | null;
}): Promise<string> {
    const type = waMediaTypeFor(args.mime);
    const media: Record<string, string> = { link: args.link };
    if (args.caption && type !== "audio") media.caption = args.caption;
    if (type === "document" && args.fileName) media.filename = args.fileName;
    const r = await graph<{ messages?: { id?: string }[] }>(`${args.fromNumberId || conversationNumberId()}/messages`, {
        method: "POST",
        body: { messaging_product: "whatsapp", recipient_type: "individual", to: `+91${args.mobile10}`, type, [type]: media },
    });
    const id = r.messages?.[0]?.id;
    if (!id) throw new Error("Meta accepted the call but returned no message id");
    return id;
}

/** A customer's attachment: Meta's media id → its bytes and type. */
export async function downloadWaMedia(mediaId: string): Promise<{ bytes: ArrayBuffer; mime: string; size: number }> {
    const info = await graph<{ url?: string; mime_type?: string; file_size?: number }>(mediaId);
    if (!info.url) throw new Error("Meta gave no media URL");
    const res = await fetch(info.url, { headers: { Authorization: `Bearer ${token()}` }, cache: "no-store" });
    if (!res.ok) throw new Error(`Meta media download failed (${res.status})`);
    const bytes = await res.arrayBuffer();
    return { bytes, mime: info.mime_type?.split(";")[0].trim() || "application/octet-stream", size: bytes.byteLength };
}
