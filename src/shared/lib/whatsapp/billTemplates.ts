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
    "DUE_SOFT",
    "DUE_FIRM",
    "DEAL_CREATED",
    "HELP_CREATED",
    "TICKET_AUTO_REPLY",
    "PAY_REQUEST",
] as const;
export type WaTemplateKind = (typeof WA_TEMPLATE_KINDS)[number];

// ── Custom templates ────────────────────────────────────────────────────────
// Staff's own templates, added on Settings → WhatsApp / Email Templates. They
// have no event of their own: a Workflow worker action sends them (actions.ts).
// Picking one by hand (chat, campaigns, 3-dot menu) is not built yet.
// The row's kind is CUSTOM_<id>; its label is the row's own name.

export type CustomTemplateKind = `CUSTOM_${string}`;
/** A built-in kind or a custom one. */
export type WaAnyKind = WaTemplateKind | CustomTemplateKind;

const CUSTOM_KIND_RE = /^CUSTOM_[A-Z0-9]{4,24}$/;
export function isCustomKind(kind: string): kind is CustomTemplateKind {
    return CUSTOM_KIND_RE.test(kind);
}
export function isWaKind(kind: string): kind is WaAnyKind {
    return (WA_TEMPLATE_KINDS as readonly string[]).includes(kind) || isCustomKind(kind);
}
/** A fresh id — base-36 time, so the list keeps the order they were added in. */
export function newCustomKind(): CustomTemplateKind {
    return `CUSTOM_${Date.now().toString(36).toUpperCase()}`;
}
export const CUSTOM_NAME_MAX = 40;
export const CUSTOM_TEMPLATE_WHEN = "A Workflow worker with the action \"Send WhatsApp template\" / \"Send email template\" set to this template is completed. Never sent by itself otherwise.";

/** Label for any kind: a custom one shows its own name. */
export function waKindLabel(kind: WaAnyKind, name?: string | null): string {
    return isCustomKind(kind) ? name?.trim() || "Untitled template" : WA_TEMPLATE_LABEL[kind];
}
export function waKindWhen(kind: WaAnyKind): string {
    return isCustomKind(kind) ? CUSTOM_TEMPLATE_WHEN : WA_TEMPLATE_WHEN[kind];
}

export const WA_TEMPLATE_LABEL: Record<WaTemplateKind, string> = {
    SALE: "Sale bill",
    RECEIPT: "Receipt",
    SALE_RETURN: "Credit note (return)",
    REFUND: "Refund",
    ORDER: "Order booked",
    ESTIMATE: "Estimate",
    REPAIR_RECEIVED: "Repair received",
    REPAIR_READY: "Repair ready",
    DUE_SOFT: "Due reminder – soft",
    DUE_FIRM: "Due reminder – firm",
    DEAL_CREATED: "Deal / Sales enquiry",
    HELP_CREATED: "Help desk support ticket",
    TICKET_AUTO_REPLY: "Active ticket auto-reply menu",
    PAY_REQUEST: "UPI payment request",
};

/** When each kind goes out by itself (Auto send on) — shown on its card. Any of
 *  them can also be sent by hand from the 3-dot menu. */
export const WA_TEMPLATE_WHEN: Record<WaTemplateKind, string> = {
    SALE: "POS sale, or an office Sale / Online invoice when posted.",
    RECEIPT: "Office Receipt posted, or money received at the counter — never to suppliers (Sundry Creditors).",
    SALE_RETURN: "Sale return posted (counter or office).",
    REFUND: "Payment voucher posted to a customer (Sundry Debtors) — not to suppliers.",
    ORDER: "POS order, or an office Sales Order when saved and posted.",
    ESTIMATE: "Estimate saved (POS or office). Auto send starts off — send from the 3-dot menu.",
    REPAIR_RECEIVED: "A repair stage with the action \"Tell customer: repair received\" is completed.",
    REPAIR_READY: "A repair stage with the action \"Tell customer: repair ready\" is completed.",
    DUE_SOFT: "Send reminder on Receivables, Send to all, or a Soft rule under Campaigns → Due Reminders.",
    DUE_FIRM: "Send reminder on Receivables, Send to all, or a Firm rule under Campaigns → Due Reminders.",
    DEAL_CREATED: "A new deal or sales enquiry is created from customer chat or CRM.",
    HELP_CREATED: "A new help desk support ticket is created from customer chat or Help module.",
    TICKET_AUTO_REPLY: "A customer with open tickets or deals sends an incoming WhatsApp message.",
    PAY_REQUEST: "WhatsApp button on the POS Share UPI QR dialog. Pay now opens the customer's UPI app with the amount filled in.",
};

/** Auto send starts on for every kind except Estimate — staff often make rough
 *  quotes, so an estimate goes only when someone presses Send. */
export function autoSendDefault(kind: WaAnyKind): boolean {
    return kind !== "ESTIMATE" && kind !== "PAY_REQUEST" && !isCustomKind(kind);
}

/** UniversalVoucher type → the template that announces it. A PAYMENT is a
 *  REFUND (sent only to a party under Sundry Debtors — checked when sending). */
const KIND_FOR_TYPE: Record<string, WaTemplateKind> = {
    SALE: "SALE",
    POS: "SALE",
    ONLINE_INVOICE: "SALE",
    SALE_RETURN: "SALE_RETURN",
    SALES_ORDER: "ORDER",
    POS_ORDER: "ORDER",
    ESTIMATE: "ESTIMATE",
    POS_ESTIMATE: "ESTIMATE",
    RECEIPT: "RECEIPT",
    PAYMENT: "REFUND",
};
/** Kinds announced for a voucher (refId = UniversalVoucher id). */
export const VOUCHER_KINDS: ReadonlySet<string> = new Set(Object.values(KIND_FOR_TYPE));
export function autoKindForVoucherType(type: string): WaTemplateKind | null {
    return KIND_FOR_TYPE[type] ?? null;
}

/** Whether staff can send a kind by hand right now. */
export type WaSendState = "ready" | "not-approved" | "off";

/** Why a "Send on WhatsApp" is greyed out — shown under the disabled item. */
export function waSendHint(state: WaSendState | undefined): string | null {
    if (state === "not-approved") return "Waiting for Meta approval (WhatsApp Templates)";
    if (state === "off") return "Switched off on WhatsApp Templates";
    return null;
}

/** Kinds whose template carries a photo header — the UPI QR of a payment
 *  request (served by /portal/b/<code>/qr). Fixed per kind, not part of the
 *  editable draft. */
export function hasImageHeader(kind: WaAnyKind): boolean {
    return kind === "PAY_REQUEST";
}

/** Repair kinds announce a ticket, not a voucher — their refId is Ticket.id. */
export function isRepairKind(kind: WaAnyKind): boolean {
    return kind === "REPAIR_RECEIVED" || kind === "REPAIR_READY";
}

/** Due reminders announce a party's whole balance, not one document — their
 *  refId is the party's Account id and Campaigns → Due Reminders decides when
 *  they go, not the Auto send switch. */
export function isDueKind(kind: WaAnyKind): kind is "DUE_SOFT" | "DUE_FIRM" {
    return kind === "DUE_SOFT" || kind === "DUE_FIRM";
}

/** The View button code a due reminder carries: /portal/b/due opens My Bills →
 *  Outstanding with the UPI pay button. */
export const DUE_LINK_CODE = "due";

/** The fields a template body may use, with the sample Meta is shown on submission. */
export const WA_FIELDS = [
    { key: "customer", label: "Customer name", sample: "Rahul Sharma" },
    { key: "billNo", label: "Document no", sample: "POS-1042" },
    { key: "amount", label: "Amount", sample: "1,250.00" },
    { key: "date", label: "Date", sample: "06 Oct 2026" },
    { key: "device", label: "Device", sample: "HP Laptop 15s" },
    { key: "subject", label: "Subject / Enquiry", sample: "CCTV camera quote" },
    // The party balance the print template shows (Previous / Closing), worded
    // for a customer: "Rs 2,500.00 due" / "Rs 300.00 advance" / "Nil".
    { key: "prevBalance", label: "Previous balance", sample: "₹2,500.00 due" },
    { key: "balance", label: "Balance now", sample: "₹3,750.00 due" },
    { key: "shop", label: "Shop name", sample: COMPANY_DETAILS.brandName },
    { key: "link", label: "Document link", sample: `${COMPANY_DETAILS.sites.shop}/portal/b/1042` },
    { key: "app", label: "App install link", sample: `${COMPANY_DETAILS.sites.shop}${SHOP_APP_INSTALL}` },
] as const;
export type WaFieldKey = (typeof WA_FIELDS)[number]["key"];
export type WaFieldValues = Record<WaFieldKey, string>;

const VOUCHER_ONLY = new Set<string>(["amount", "prevBalance", "balance"]);
/** A due reminder: {amount} is the balance due, {date} the oldest unpaid bill's date. */
const DUE_FIELDS = new Set<string>(["customer", "amount", "date", "shop", "link", "app"]);
const DEAL_FIELDS = new Set<string>(["customer", "subject", "shop", "link", "app", "date"]);
const HELP_FIELDS = new Set<string>(["customer", "subject", "billNo", "shop", "link", "app", "date"]);
const AUTO_REPLY_FIELDS = new Set<string>(["customer", "shop"]);
/** A UPI payment request: {billNo} is the bill / note the cashier typed, may be blank. */
const PAY_FIELDS = new Set<string>(["customer", "amount", "billNo", "shop"]);
/** A custom template has no document behind it — only what every customer has. */
const CUSTOM_FIELDS = new Set<string>(["customer", "shop", "app"]);

/** Fields a kind can fill: a repair has a device and no money; a voucher the reverse. */
export function fieldsFor(kind: WaAnyKind): readonly (typeof WA_FIELDS)[number][] {
    if (isCustomKind(kind)) return WA_FIELDS.filter((f) => CUSTOM_FIELDS.has(f.key));
    if (isDueKind(kind)) return WA_FIELDS.filter((f) => DUE_FIELDS.has(f.key));
    if (kind === "DEAL_CREATED") return WA_FIELDS.filter((f) => DEAL_FIELDS.has(f.key));
    if (kind === "HELP_CREATED") return WA_FIELDS.filter((f) => HELP_FIELDS.has(f.key));
    if (kind === "TICKET_AUTO_REPLY") return WA_FIELDS.filter((f) => AUTO_REPLY_FIELDS.has(f.key));
    if (kind === "PAY_REQUEST") return WA_FIELDS.filter((f) => PAY_FIELDS.has(f.key));
    return WA_FIELDS.filter((f) => (isRepairKind(kind) ? !VOUCHER_ONLY.has(f.key) && f.key !== "subject" : f.key !== "device" && f.key !== "subject"));
}

const FIELD_KEYS = new Set<string>(WA_FIELDS.map((f) => f.key));
const FIELD_RE = /\{(\w+)\}/g;

export type WaTemplateDraft = {
    body: string;
    /** "View" button text; null = no button. */
    viewButton: string | null;
    /** "Open in app" button text; null = no button. */
    appButton: string | null;
};

/** Closing paragraph of every template — the customer's whole account is on the portal. */
const PORTAL_LINE =
    "All your bills, payments, warranty details and repair status are available anytime " +
    "in your account on our website and app. Tap Open in app to see them.";

/** Customer care — call or WhatsApp. Ends every default body. */
const CARE_NO = COMPANY_DETAILS.contact.phone.replace(/^\+91\s*/, "");
const HELP_LINE = `\n\nNeed help? Call or WhatsApp us at ${CARE_NO}.`;

const SHOP_ADDRESS = [COMPANY_DETAILS.address.line1, COMPANY_DETAILS.address.line2, COMPANY_DETAILS.address.pin]
    .filter(Boolean)
    .join(", ");

/** One-tap "Call us" button on every template that has buttons — Meta wants E.164. */
export const WA_CALL_BUTTON = { text: "Call us", phone: COMPANY_DETAILS.contact.phone.replace(/\s+/g, "") };

/** "Bill no: {billNo}\nDate: {date}\nAmount: Rs {amount}" block. */
const docLines = (noLabel: string, amountLabel = "Amount") =>
    `${noLabel}: {billNo}\nDate: {date}\n${amountLabel}: Rs {amount}\n\n`;

/** The party balance, as the bill / receipt print shows it. */
const BALANCE_LINES = "Previous balance: {prevBalance}\nBalance now: {balance}\n\n";

// Owner's wording, 2026-10-07, and the same shape for every other kind. Kept free
// of promotion ("offers", "discount") so Meta files them as UTILITY, not the
// dearer MARKETING.
export const WA_TEMPLATE_DEFAULTS: Record<WaTemplateKind, WaTemplateDraft> = {
    SALE: {
        body:
            "Dear {customer}, thank you for your purchase at {shop}.\n\n" +
            docLines("Bill no") +
            BALANCE_LINES +
            "Tap View bill to see or download this bill.\n\n" +
            PORTAL_LINE +
            HELP_LINE,
        viewButton: "View bill",
        appButton: "Open in app",
    },
    RECEIPT: {
        body:
            "Dear {customer}, we have received your payment at {shop}.\n\n" +
            docLines("Receipt no") +
            BALANCE_LINES +
            "Tap View receipt to see or download this receipt.\n\n" +
            PORTAL_LINE +
            HELP_LINE,
        viewButton: "View receipt",
        appButton: "Open in app",
    },
    SALE_RETURN: {
        body:
            "Dear {customer}, your return at {shop} has been accepted.\n\n" +
            docLines("Credit note no") +
            "Tap View credit note to see or download it.\n\n" +
            PORTAL_LINE +
            HELP_LINE,
        viewButton: "View credit note",
        appButton: "Open in app",
    },
    REFUND: {
        body:
            "Dear {customer}, your refund from {shop} has been paid.\n\n" +
            docLines("Refund no") +
            "Tap View refund to see or download the slip.\n\n" +
            PORTAL_LINE +
            HELP_LINE,
        viewButton: "View refund",
        appButton: "Open in app",
    },
    ORDER: {
        body:
            "Dear {customer}, your order at {shop} has been booked.\n\n" +
            docLines("Order no", "Order value") +
            "Tap View order to see its details. We will inform you when it is ready.\n\n" +
            PORTAL_LINE +
            HELP_LINE,
        viewButton: "View order",
        appButton: "Open in app",
    },
    ESTIMATE: {
        body:
            "Dear {customer}, here is the estimate you asked for at {shop}.\n\n" +
            docLines("Estimate no") +
            "Tap View estimate to see or download it.\n\n" +
            PORTAL_LINE +
            HELP_LINE,
        viewButton: "View estimate",
        appButton: "Open in app",
    },
    REPAIR_RECEIVED: {
        body:
            "Dear {customer}, we have received your {device} for repair at {shop}.\n\n" +
            "Job no: {billNo}\nDate: {date}\n\n" +
            "Tap Track repair to follow its status.\n\n" +
            PORTAL_LINE +
            HELP_LINE,
        viewButton: "Track repair",
        appButton: "Open in app",
    },
    REPAIR_READY: {
        body:
            "Dear {customer}, your {device} is ready for pickup at {shop}.\n\n" +
            "Job no: {billNo}\n\n" +
            "Please show this message when you collect it. Tap Track repair to see the details.\n\n" +
            `Shop address: ${SHOP_ADDRESS}\n\n` +
            PORTAL_LINE +
            HELP_LINE,
        viewButton: "Track repair",
        appButton: "Open in app",
    },
    // A reminder, not a sales push — kept free of offers so Meta files it as UTILITY.
    DUE_SOFT: {
        body:
            "Dear {customer}, this is a friendly reminder from {shop}.\n\n" +
            "Balance due: Rs {amount}\n\n" +
            "Tap Pay now to see your bills and pay by UPI. Please ignore this message if you have already paid. Thank you." +
            HELP_LINE,
        viewButton: "Pay now",
        appButton: "Open in app",
    },
    DUE_FIRM: {
        body:
            "Dear {customer}, Rs {amount} has been due at {shop} since {date}.\n\n" +
            "Please clear it at the earliest. Tap Pay now to see your bills and pay by UPI. Please ignore this message if you have already paid." +
            HELP_LINE,
        viewButton: "Pay now",
        appButton: "Open in app",
    },
    DEAL_CREATED: {
        body:
            "Hello {customer}, thank you for contacting {shop}! 👋\n\n" +
            "We have noted your enquiry regarding {subject}. Our team will review the details and get back to you with the best options shortly.\n\n" +
            "Tap View details to check your enquiry anytime." +
            HELP_LINE,
        viewButton: "View details",
        appButton: "Open in app",
    },
    HELP_CREATED: {
        body:
            "Hello {customer}, thank you for reaching out to {shop}! 👋\n\n" +
            "We have received your message regarding {subject}. Our support team is attending to it and will reply to you here shortly.\n\n" +
            "Tap View ticket to follow updates." +
            HELP_LINE,
        viewButton: "View ticket",
        appButton: "Open in app",
    },
    TICKET_AUTO_REPLY: {
        body:
            "Hi {customer} 👋 Good to hear from you again!",
        viewButton: null,
        appButton: null,
    },
    // Pay now opens /portal/b/p<signed> → the customer's UPI app (upiPayLink.ts).
    PAY_REQUEST: {
        body:
            "Dear {customer}, please pay Rs {amount} to {shop}.\n\n" +
            "Tap Pay now to open your UPI app (GPay, PhonePe, Paytm) with the amount filled in. " +
            "Please ignore this message if you have already paid. Thank you." +
            HELP_LINE,
        viewButton: "Pay now",
        appButton: null,
    },
};

/** Starting wording of a new custom template. No View button — there is no document to open. */
export const CUSTOM_TEMPLATE_DEFAULT: WaTemplateDraft = {
    body: "Dear {customer}, greetings from {shop}." + HELP_LINE,
    viewButton: null,
    appButton: "Open in app",
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

const BASE_SAMPLES = Object.fromEntries(WA_FIELDS.map((f) => [f.key, f.sample])) as WaFieldValues;

/** A realistic document number per kind — for the preview, the test send and
 *  the example Meta reviews (a repair job showing "POS-1042" reads wrong). */
const SAMPLE_DOC_NO: Record<WaTemplateKind, string> = {
    SALE: "POS-1042",
    RECEIPT: "RV-2207",
    SALE_RETURN: "SR-0311",
    REFUND: "PMT-0158",
    ORDER: "POSO-0087",
    ESTIMATE: "EST-0419",
    REPAIR_RECEIVED: "#2051",
    REPAIR_READY: "#2051",
    DUE_SOFT: "",
    DUE_FIRM: "",
    DEAL_CREATED: "",
    HELP_CREATED: "#1042",
    TICKET_AUTO_REPLY: "",
    PAY_REQUEST: "",
};

export function sampleValuesFor(kind: WaAnyKind): WaFieldValues {
    if (isCustomKind(kind)) return BASE_SAMPLES;
    const v = { ...BASE_SAMPLES, billNo: SAMPLE_DOC_NO[kind] };
    // Money in brings the balance down; everything else adds to it.
    if (kind === "RECEIPT") return { ...v, prevBalance: "₹3,750.00 due", balance: "₹2,500.00 due" };
    if (isDueKind(kind)) return { ...v, amount: "4,250.00", date: "12 Aug 2026", link: `${WA_BILL_LINK_BASE}${DUE_LINK_CODE}` };
    return v;
}

/** Problems Meta would reject the draft for — empty means fine. */
export function checkBody(draft: WaTemplateDraft, kind?: WaAnyKind): string[] {
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
            if (!allowed.has(k)) errs.push(`{${k}} has no value in this template — remove it.`);
        }
        if (isCustomKind(kind) && draft.viewButton?.trim()) errs.push("A custom template has no document to open — remove the View button.");
    }
    if (/^\{\w+\}/.test(body)) errs.push("The message cannot start with a field — put a word before it.");
    if (/\{\w+\}[.!\s]*$/.test(body)) errs.push("The message cannot end with a field — put a word after it.");
    if (/\}\s*\{/.test(body)) errs.push("Two fields cannot sit side by side — put a word between them.");
    for (const b of [draft.viewButton, draft.appButton]) {
        if (b != null && b.trim().length > 25) errs.push(`Button "${b}" is longer than 25 characters.`);
    }
    return errs;
}
