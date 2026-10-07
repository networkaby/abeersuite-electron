import "server-only";
import {
    WA_APP_LINK,
    WA_BILL_LINK_BASE,
    WA_SAMPLE_VALUES,
    bodyFieldOrder,
    toMetaBody,
    type WaFieldValues,
    type WaTemplateDraft,
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
    return Boolean(token() && process.env.META_WA_PHONE_NUMBER_ID);
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

/** Meta's component list for a draft — body plus the optional URL buttons. */
function components(draft: WaTemplateDraft) {
    const order = bodyFieldOrder(draft.body);
    const list: unknown[] = [
        {
            type: "BODY",
            text: toMetaBody(draft.body.trim()),
            ...(order.length ? { example: { body_text: [order.map((k) => WA_SAMPLE_VALUES[k])] } } : {}),
        },
    ];
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
    if (buttons.length) list.push({ type: "BUTTONS", buttons });
    return list;
}

/** Send a draft to Meta for approval. Meta answers PENDING (or sometimes
 *  APPROVED straight away for a clean utility template). */
export async function submitTemplate(name: string, draft: WaTemplateDraft): Promise<{ id: string; status: string }> {
    const r = await graph<{ id: string; status: string }>(
        `${process.env.META_WA_BUSINESS_ACCOUNT_ID}/message_templates`,
        { method: "POST", body: { name, language: LANG, category: "UTILITY", components: components(draft) } },
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
}): Promise<string> {
    const order = bodyFieldOrder(args.approved.body);
    const comps: unknown[] = [];
    if (order.length) {
        comps.push({ type: "body", parameters: order.map((k) => ({ type: "text", text: args.values[k] })) });
    }
    // Only the View button carries a variable; the app button's URL is fixed.
    if (args.approved.viewButton?.trim()) {
        comps.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: args.linkCode }] });
    }
    const r = await graph<{ messages?: { id?: string }[] }>(`${process.env.META_WA_PHONE_NUMBER_ID}/messages`, {
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
