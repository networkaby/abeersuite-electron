import "server-only";
import QRCode from "qrcode";
import { appSetting } from "@/shared/lib/settings/appSettings.server";
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
    type WaAnyKind,
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

/** Settings → App Settings, else .env. */
const token = () => appSetting("META_WA_ACCESS_TOKEN");

export async function isTemplateApiConfigured(): Promise<boolean> {
    return Boolean((await token()) && (await wabaId()));
}
export async function isBillSendConfigured(): Promise<boolean> {
    return Boolean((await token()) && (await conversationNumberId()));
}

/** WABA id — Settings → App Settings, else .env. */
const wabaId = () => appSetting("META_WA_BUSINESS_ACCOUNT_ID");

/**
 * The number bills, reminders and new replies go out from: WA_CONVERSATION_NUMBER_ID,
 * else the OTP number META_WA_PHONE_NUMBER_ID. Both are Settings → App Settings
 * values (DB first, then .env).
 */
export async function conversationNumberId(): Promise<string | undefined> {
    return (await appSetting("WA_CONVERSATION_NUMBER_ID")) || (await appSetting("META_WA_PHONE_NUMBER_ID"));
}

type GraphError = { error?: { message?: string; error_user_msg?: string } };

/** One Graph call; throws with Meta's own wording on failure. */
async function graph<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const res = await fetch(`${GRAPH}/${path}`, {
        method: init?.method ?? "GET",
        headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
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
/** The shop's Meta app (loginapi) — Settings → App Settings, else .env; read when
 *  needed so a server without it says so instead of calling Meta with an empty id. */
export const metaAppId = async () => (await appSetting("META_APP_ID")) || "";
export const META_APP_ID_MISSING = "META_APP_ID is not set (Settings → App Settings or .env).";

async function uploadHeaderSample(bytes: Uint8Array, mime: string): Promise<string> {
    const appId = await metaAppId();
    if (!appId) throw new Error(META_APP_ID_MISSING);
    const session = await graph<{ id: string }>(
        `${appId}/uploads?file_length=${bytes.byteLength}&file_type=${encodeURIComponent(mime)}`,
        { method: "POST" },
    );
    const res = await fetch(`${GRAPH}/${session.id}`, {
        method: "POST",
        headers: { Authorization: `OAuth ${await token()}`, file_offset: "0" },
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
async function components(kind: WaAnyKind, draft: WaTemplateDraft) {
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
export async function submitTemplate(kind: WaAnyKind, name: string, draft: WaTemplateDraft): Promise<{ id: string; status: string }> {
    const r = await graph<{ id: string; status: string }>(
        `${await wabaId()}/message_templates`,
        { method: "POST", body: { name, language: LANG, category: "UTILITY", components: await components(kind, draft) } },
    );
    return { id: r.id, status: r.status };
}

export type MetaTemplateStatus = { status: string; rejectReason: string | null } | null;

/** Current approval status of a submitted template; null when Meta has no such name. */
export async function fetchTemplateStatus(name: string): Promise<MetaTemplateStatus> {
    const r = await graph<{ data: { name: string; status: string; rejected_reason?: string }[] }>(
        `${await wabaId()}/message_templates?name=${encodeURIComponent(name)}&fields=name,status,rejected_reason`,
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
    const r = await graph<{ messages?: { id?: string }[] }>(`${await conversationNumberId()}/messages`, {
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
    const r = await graph<{ messages?: { id?: string }[] }>(`${fromNumberId || (await conversationNumberId())}/messages`, {
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

/**
 * Block / unblock a number on one of our WhatsApp numbers. Blocked, they cannot
 * message that number and we cannot message them. Meta allows a block only
 * within 24 hours of their last message to it; an unblock any time.
 */
export async function setWaUserBlocked(mobile10: string, blocked: boolean, numberId: string): Promise<void> {
    await graph(`${numberId}/block_users`, {
        method: blocked ? "POST" : "DELETE",
        body: { messaging_product: "whatsapp", block_users: [{ user: `+91${mobile10}` }] },
    });
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
    const r = await graph<{ messages?: { id?: string }[] }>(`${args.fromNumberId || (await conversationNumberId())}/messages`, {
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
    const res = await fetch(info.url, { headers: { Authorization: `Bearer ${await token()}` }, cache: "no-store" });
    if (!res.ok) throw new Error(`Meta media download failed (${res.status})`);
    const bytes = await res.arrayBuffer();
    return { bytes, mime: info.mime_type?.split(";")[0].trim() || "application/octet-stream", size: bytes.byteLength };
}

export type WaPhoneNumber = { id: string; display: string; name: string; status: string; nameStatus: string; quality: string };

/** Every number in the WABA, for the App Settings picker. Throws Meta's wording. */
export async function listWaPhoneNumbers(): Promise<WaPhoneNumber[]> {
    const waba = await wabaId();
    if (!(await token()) || !waba) throw new Error("Set the WhatsApp Business Account ID (and META_WA_ACCESS_TOKEN in Vercel) first.");
    type Row = { id: string; display_phone_number?: string; verified_name?: string; status?: string; name_status?: string; quality_rating?: string };
    const r = await graph<{ data: Row[] }>(`${waba}/phone_numbers?fields=id,display_phone_number,verified_name,status,name_status,quality_rating`);
    return r.data.map((n) => ({
        id: n.id,
        display: n.display_phone_number ?? "",
        name: n.verified_name ?? "",
        status: n.status ?? "",
        nameStatus: n.name_status ?? "",
        quality: n.quality_rating ?? "",
    }));
}

/** Register a cloud number with its 2-step PIN — the step that takes it from
 *  Pending to Connected (WhatsApp Manager has no button for it). The PIN is set
 *  here on first registration; keep it, Meta asks for it on any re-register. */
export async function registerWaPhoneNumber(phoneNumberId: string, pin: string): Promise<void> {
    await graph<{ success?: boolean }>(`${phoneNumberId}/register`, {
        method: "POST",
        body: { messaging_product: "whatsapp", pin },
    });
}
