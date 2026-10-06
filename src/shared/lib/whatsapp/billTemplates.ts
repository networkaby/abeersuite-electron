/**
 * WhatsApp bill / receipt templates — the wording side, shared by the office
 * editor (live preview) and the server (Meta submission + sending).
 *
 * Staff write friendly fields — `{customer}`, `{billNo}` — and never see Meta's
 * numbered slots. `toMetaBody()` numbers them in order of first appearance, and
 * the same order is used when a bill is sent, so the two can never disagree.
 *
 * Meta's rules for a template body (checked by `checkBody`, so a draft is
 * refused here instead of being rejected by Meta a day later):
 *   - it may not start or end with a field
 *   - two fields may not sit side by side with nothing between them
 *   - at most 1024 characters
 */

import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { SHOP_APP_INSTALL } from "@/shared/lib/device/shopApp";

export const WA_TEMPLATE_KINDS = ["SALE", "RECEIPT"] as const;
export type WaTemplateKind = (typeof WA_TEMPLATE_KINDS)[number];

export const WA_TEMPLATE_LABEL: Record<WaTemplateKind, string> = {
    SALE: "Sale bill",
    RECEIPT: "Receipt",
};

/** The fields a template body may use, with the sample Meta is shown on submission. */
export const WA_FIELDS = [
    { key: "customer", label: "Customer name", sample: "Rahul Sharma" },
    { key: "billNo", label: "Bill no", sample: "POS-1042" },
    { key: "amount", label: "Amount", sample: "1,250.00" },
    { key: "date", label: "Date", sample: "06 Oct 2026" },
    { key: "shop", label: "Shop name", sample: COMPANY_DETAILS.brandName },
    { key: "link", label: "Bill link", sample: `${COMPANY_DETAILS.sites.shop}/portal/b/1042` },
    { key: "app", label: "App install link", sample: `${COMPANY_DETAILS.sites.shop}${SHOP_APP_INSTALL}` },
] as const;
export type WaFieldKey = (typeof WA_FIELDS)[number]["key"];
export type WaFieldValues = Record<WaFieldKey, string>;

const FIELD_KEYS = new Set<string>(WA_FIELDS.map((f) => f.key));
const FIELD_RE = /\{(\w+)\}/g;

export type WaTemplateDraft = {
    body: string;
    /** "View bill" button text; null = no button. */
    viewButton: string | null;
    /** "Get our app" button text; null = no button. */
    appButton: string | null;
};

export const WA_TEMPLATE_DEFAULTS: Record<WaTemplateKind, WaTemplateDraft> = {
    SALE: {
        body:
            "Dear {customer}, thank you for shopping at {shop}.\n\n" +
            "Your bill {billNo} dated {date} for Rs {amount} is ready. Tap View bill to see or download it.\n\n" +
            "Get our app to receive your bills and offers instantly.",
        viewButton: "View bill",
        appButton: "Get our app",
    },
    RECEIPT: {
        body:
            "Dear {customer}, we have received Rs {amount} on {date} at {shop}.\n\n" +
            "Your receipt no. is {billNo}. Tap View receipt to see or download it.\n\n" +
            "Get our app to receive your receipts instantly.",
        viewButton: "View receipt",
        appButton: "Get our app",
    },
};

/** Bill link and app link — the button URLs Meta approves. The bill button's
 *  last part is the voucher id, the one variable Meta allows in a URL button. */
export const WA_BILL_LINK_BASE = `${COMPANY_DETAILS.sites.shop}/portal/b/`;
export const WA_APP_LINK = `${COMPANY_DETAILS.sites.shop}${SHOP_APP_INSTALL}`;

/** Fields in order of first appearance — slot {{n}} is index n-1. */
export function bodyFieldOrder(body: string): WaFieldKey[] {
    const order: WaFieldKey[] = [];
    for (const m of body.matchAll(FIELD_RE)) {
        const k = m[1] as WaFieldKey;
        if (FIELD_KEYS.has(k) && !order.includes(k)) order.push(k);
    }
    return order;
}

/** `{customer}` → `{{1}}`, in bodyFieldOrder's numbering. */
export function toMetaBody(body: string): string {
    const order = bodyFieldOrder(body);
    return body.replace(FIELD_RE, (whole, k: string) => {
        const i = order.indexOf(k as WaFieldKey);
        return i >= 0 ? `{{${i + 1}}}` : whole;
    });
}

/** Fill the fields for the on-screen preview. */
export function fillBody(body: string, values: Partial<WaFieldValues>): string {
    return body.replace(FIELD_RE, (whole, k: string) => values[k as WaFieldKey] ?? whole);
}

export const WA_SAMPLE_VALUES = Object.fromEntries(WA_FIELDS.map((f) => [f.key, f.sample])) as WaFieldValues;

/** Problems Meta would reject the draft for — empty means fine. */
export function checkBody(draft: WaTemplateDraft): string[] {
    const errs: string[] = [];
    const body = draft.body.trim();
    if (!body) return ["Message is empty."];
    if (body.length > 1024) errs.push(`Message is ${body.length} characters; WhatsApp allows 1024.`);
    for (const m of body.matchAll(FIELD_RE)) {
        if (!FIELD_KEYS.has(m[1])) errs.push(`{${m[1]}} is not a field — use the buttons to insert one.`);
    }
    if (/^\{\w+\}/.test(body)) errs.push("The message cannot start with a field — put a word before it.");
    if (/\{\w+\}[.!\s]*$/.test(body)) errs.push("The message cannot end with a field — put a word after it.");
    if (/\}\s*\{/.test(body)) errs.push("Two fields cannot sit side by side — put a word between them.");
    for (const b of [draft.viewButton, draft.appButton]) {
        if (b != null && b.trim().length > 25) errs.push(`Button "${b}" is longer than 25 characters.`);
    }
    return errs;
}
