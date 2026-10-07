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

export const WA_TEMPLATE_KINDS = [
    "SALE",
    "RECEIPT",
    "SALE_RETURN",
    "REFUND",
    "ORDER",
    "ESTIMATE",
    "REPAIR_RECEIVED",
    "REPAIR_READY",
] as const;
export type WaTemplateKind = (typeof WA_TEMPLATE_KINDS)[number];

export const WA_TEMPLATE_LABEL: Record<WaTemplateKind, string> = {
    SALE: "Sale bill",
    RECEIPT: "Receipt",
    SALE_RETURN: "Credit note (return)",
    REFUND: "Refund",
    ORDER: "Order booked",
    ESTIMATE: "Estimate",
    REPAIR_RECEIVED: "Repair received",
    REPAIR_READY: "Repair ready",
};

/** When each kind goes out — shown on its card. */
export const WA_TEMPLATE_WHEN: Record<WaTemplateKind, string> = {
    SALE: "POS sale, or an office Sale / Online invoice when posted.",
    RECEIPT: "Office Receipt posted, or money received at the counter.",
    SALE_RETURN: "Sale return posted (counter or office).",
    REFUND: "Payment voucher posted to a customer (Sundry Debtors) — not to suppliers.",
    ORDER: "POS order, or an office Sales Order when saved and posted.",
    ESTIMATE: "Only when staff press \"Send on WhatsApp\" on the estimate.",
    REPAIR_RECEIVED: "A repair stage with the action \"Tell customer: repair received\" is completed.",
    REPAIR_READY: "A repair stage with the action \"Tell customer: repair ready\" is completed.",
};

/** Repair kinds announce a ticket, not a voucher — their refId is Ticket.id. */
export function isRepairKind(kind: WaTemplateKind): boolean {
    return kind === "REPAIR_RECEIVED" || kind === "REPAIR_READY";
}

/** The fields a template body may use, with the sample Meta is shown on submission. */
export const WA_FIELDS = [
    { key: "customer", label: "Customer name", sample: "Rahul Sharma" },
    { key: "billNo", label: "Document no", sample: "POS-1042" },
    { key: "amount", label: "Amount", sample: "1,250.00" },
    { key: "date", label: "Date", sample: "06 Oct 2026" },
    { key: "device", label: "Device", sample: "HP Laptop 15s" },
    { key: "shop", label: "Shop name", sample: COMPANY_DETAILS.brandName },
    { key: "link", label: "Document link", sample: `${COMPANY_DETAILS.sites.shop}/portal/b/1042` },
    { key: "app", label: "App install link", sample: `${COMPANY_DETAILS.sites.shop}${SHOP_APP_INSTALL}` },
] as const;
export type WaFieldKey = (typeof WA_FIELDS)[number]["key"];
export type WaFieldValues = Record<WaFieldKey, string>;

/** Fields a kind can fill: a repair has a device and no amount; a voucher the reverse. */
export function fieldsFor(kind: WaTemplateKind): readonly (typeof WA_FIELDS)[number][] {
    return WA_FIELDS.filter((f) => (isRepairKind(kind) ? f.key !== "amount" : f.key !== "device"));
}

const FIELD_KEYS = new Set<string>(WA_FIELDS.map((f) => f.key));
const FIELD_RE = /\{(\w+)\}/g;

export type WaTemplateDraft = {
    body: string;
    /** "View" button text; null = no button. */
    viewButton: string | null;
    /** "Get our app" button text; null = no button. */
    appButton: string | null;
};

/** Closing paragraph of every template — the customer's whole account is on the portal. */
const PORTAL_LINE =
    "All your bills, payments, warranty details and repair status are available anytime " +
    "in your account on our website and app. Tap Get our app to install it.";

/** "Bill no: {billNo}\nDate: {date}\nAmount: Rs {amount}" block. */
const docLines = (noLabel: string, amountLabel = "Amount") =>
    `${noLabel}: {billNo}\nDate: {date}\n${amountLabel}: Rs {amount}\n\n`;

// Owner's wording, 2026-10-07, and the same shape for every other kind. Kept free
// of promotion ("offers", "discount") so Meta files them as UTILITY, not the
// dearer MARKETING.
export const WA_TEMPLATE_DEFAULTS: Record<WaTemplateKind, WaTemplateDraft> = {
    SALE: {
        body:
            "Dear {customer}, thank you for your purchase at {shop}.\n\n" +
            docLines("Bill no") +
            "Tap View bill to see or download this bill.\n\n" +
            PORTAL_LINE,
        viewButton: "View bill",
        appButton: "Get our app",
    },
    RECEIPT: {
        body:
            "Dear {customer}, we have received your payment at {shop}.\n\n" +
            docLines("Receipt no") +
            "Tap View receipt to see or download this receipt.\n\n" +
            PORTAL_LINE,
        viewButton: "View receipt",
        appButton: "Get our app",
    },
    SALE_RETURN: {
        body:
            "Dear {customer}, your return at {shop} has been accepted.\n\n" +
            docLines("Credit note no") +
            "Tap View credit note to see or download it.\n\n" +
            PORTAL_LINE,
        viewButton: "View credit note",
        appButton: "Get our app",
    },
    REFUND: {
        body:
            "Dear {customer}, your refund from {shop} has been paid.\n\n" +
            docLines("Refund no") +
            "Tap View refund to see or download the slip.\n\n" +
            PORTAL_LINE,
        viewButton: "View refund",
        appButton: "Get our app",
    },
    ORDER: {
        body:
            "Dear {customer}, your order at {shop} has been booked.\n\n" +
            docLines("Order no", "Order value") +
            "Tap View order to see its details. We will inform you when it is ready.\n\n" +
            PORTAL_LINE,
        viewButton: "View order",
        appButton: "Get our app",
    },
    ESTIMATE: {
        body:
            "Dear {customer}, here is the estimate you asked for at {shop}.\n\n" +
            docLines("Estimate no") +
            "Tap View estimate to see or download it.\n\n" +
            PORTAL_LINE,
        viewButton: "View estimate",
        appButton: "Get our app",
    },
    REPAIR_RECEIVED: {
        body:
            "Dear {customer}, we have received your {device} for repair at {shop}.\n\n" +
            "Job no: {billNo}\nDate: {date}\n\n" +
            "Tap Track repair to follow its status.\n\n" +
            PORTAL_LINE,
        viewButton: "Track repair",
        appButton: "Get our app",
    },
    REPAIR_READY: {
        body:
            "Dear {customer}, your {device} is ready for pickup at {shop}.\n\n" +
            "Job no: {billNo}\n\n" +
            "Please show this message when you collect it. Tap Track repair to see the details.\n\n" +
            PORTAL_LINE,
        viewButton: "Track repair",
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
export function checkBody(draft: WaTemplateDraft, kind?: WaTemplateKind): string[] {
    const errs: string[] = [];
    const body = draft.body.trim();
    if (!body) return ["Message is empty."];
    if (body.length > 1024) errs.push(`Message is ${body.length} characters; WhatsApp allows 1024.`);
    for (const m of body.matchAll(FIELD_RE)) {
        if (!FIELD_KEYS.has(m[1])) errs.push(`{${m[1]}} is not a field — use the buttons to insert one.`);
    }
    // A field this kind cannot fill would go to Meta empty, and Meta refuses that.
    if (kind) {
        const allowed = new Set<string>(fieldsFor(kind).map((f) => f.key));
        for (const k of bodyFieldOrder(body)) {
            if (!allowed.has(k)) errs.push(`{${k}} has no value for a ${WA_TEMPLATE_LABEL[kind]} message — remove it.`);
        }
    }
    if (/^\{\w+\}/.test(body)) errs.push("The message cannot start with a field — put a word before it.");
    if (/\{\w+\}[.!\s]*$/.test(body)) errs.push("The message cannot end with a field — put a word after it.");
    if (/\}\s*\{/.test(body)) errs.push("Two fields cannot sit side by side — put a word between them.");
    for (const b of [draft.viewButton, draft.appButton]) {
        if (b != null && b.trim().length > 25) errs.push(`Button "${b}" is longer than 25 characters.`);
    }
    return errs;
}
