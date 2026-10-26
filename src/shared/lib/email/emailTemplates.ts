/**
 * Email templates — the wording side, shared by the office editor (live
 * preview) and the server (sending).
 *
 * Three families, one table and one editor:
 *   - documents (bill, receipt, …), repairs and due reminders — the email twins
 *     of the WhatsApp kinds, using WhatsApp's fields and samples so a field
 *     means one thing on both channels;
 *   - shop reminders (abandoned cart, payment pending) sent by the hourly job
 *     (emailReminders.ts);
 *   - welcome, on a new portal account.
 *
 * Unlike WhatsApp there is no approval step and no slot rules — the saved
 * subject + body are what goes out. MARKETING kinds always carry an
 * unsubscribe line the template cannot remove.
 */

import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { SHOP_APP_INSTALL } from "@/shared/lib/device/shopApp";
import {
    WA_FIELDS,
    WA_TEMPLATE_LABEL,
    WA_TEMPLATE_WHEN,
    autoKindForVoucherType,
    fieldsFor,
    sampleValuesFor,
    type WaTemplateKind,
} from "@/shared/lib/whatsapp/billTemplates";

/** Kinds that are also WhatsApp kinds — same fields, samples and "when". */
const SHARED_KINDS = [
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
] as const satisfies readonly WaTemplateKind[];
type SharedKind = (typeof SHARED_KINDS)[number];

export const EMAIL_TEMPLATE_KINDS = [...SHARED_KINDS, "CART_ABANDONED", "PAYMENT_PENDING", "WELCOME"] as const;
export type EmailTemplateKind = (typeof EMAIL_TEMPLATE_KINDS)[number];

const isShared = (k: EmailTemplateKind): k is SharedKind => (SHARED_KINDS as readonly string[]).includes(k);

export function isEmailKind(kind: string): kind is EmailTemplateKind {
    return (EMAIL_TEMPLATE_KINDS as readonly string[]).includes(kind);
}

/** Promotional: skipped for anyone who unsubscribed, and always carries the
 *  unsubscribe line. Bills, receipts, repairs and dues are not — a customer
 *  cannot opt out of their own documents. */
export function isMarketingKind(kind: EmailTemplateKind): boolean {
    return kind === "CART_ABANDONED" || kind === "WELCOME";
}

/** Only a document / repair kind goes "on a save", so only those have an Auto
 *  send switch; the rest are sent by their own trigger whenever switched on. */
export function hasAutoSendSwitch(kind: EmailTemplateKind): boolean {
    return isShared(kind) && kind !== "DUE_SOFT" && kind !== "DUE_FIRM";
}

const DOC_KINDS = ["SALE", "RECEIPT", "SALE_RETURN", "REFUND", "ORDER", "ESTIMATE"] as const;
export type DocEmailKind = (typeof DOC_KINDS)[number];

/** A kind that announces a posted voucher (refId = UniversalVoucher id). */
export function isDocEmailKind(kind: string): kind is DocEmailKind {
    return (DOC_KINDS as readonly string[]).includes(kind);
}

/** UniversalVoucher type → the email kind that announces it, or null. */
export function emailKindForVoucherType(type: string): DocEmailKind | null {
    const k = autoKindForVoucherType(type);
    return k && isDocEmailKind(k) ? k : null;
}

/** Estimates start off, as on WhatsApp — staff make rough quotes. */
export function emailAutoSendDefault(kind: EmailTemplateKind): boolean {
    return kind !== "ESTIMATE";
}

/** Hours a cart / unpaid online order waits before its one reminder. */
export const REMINDER_AFTER_HOURS = 4;
/** Older than this is not reminded at all — the moment has passed. */
export const REMINDER_MAX_AGE_DAYS = 7;

export const EMAIL_TEMPLATE_LABEL: Record<EmailTemplateKind, string> = {
    ...(Object.fromEntries(SHARED_KINDS.map((k) => [k, WA_TEMPLATE_LABEL[k]])) as Record<SharedKind, string>),
    CART_ABANDONED: "Abandoned cart",
    PAYMENT_PENDING: "Payment pending",
    WELCOME: "Welcome (new account)",
};

export const EMAIL_TEMPLATE_WHEN: Record<EmailTemplateKind, string> = {
    ...(Object.fromEntries(SHARED_KINDS.map((k) => [k, WA_TEMPLATE_WHEN[k]])) as Record<SharedKind, string>),
    ESTIMATE: "Estimate saved (POS or office). Auto send starts off — send from the 3-dot menu.",
    CART_ABANDONED: `A signed-in customer leaves items in the shop / app cart for ${REMINDER_AFTER_HOURS} hours without ordering. Once per cart; not for carts older than ${REMINDER_MAX_AGE_DAYS} days.`,
    PAYMENT_PENDING: `An online-payment order is still unpaid ${REMINDER_AFTER_HOURS} hours after it was placed. Once per order.`,
    WELCOME: "A customer creates an account on the website or app.",
};

// ── Fields ──────────────────────────────────────────────────────────────────

const SHOP_URL = COMPANY_DETAILS.sites.shop;

/** WhatsApp's fields plus the shop-reminder ones. */
export const EMAIL_FIELDS = [
    ...WA_FIELDS,
    { key: "items", label: "Cart items", sample: "1 × HP Wireless Mouse\n2 × A4 Paper Ream" },
    { key: "total", label: "Cart total", sample: "1,890.00" },
    { key: "cartLink", label: "Cart link", sample: `${SHOP_URL}/shop/cart` },
] as const;
export type EmailFieldKey = (typeof EMAIL_FIELDS)[number]["key"];
export type EmailFieldValues = Partial<Record<EmailFieldKey, string>>;
type EmailField = (typeof EMAIL_FIELDS)[number];

const OWN_FIELDS: Record<Exclude<EmailTemplateKind, SharedKind>, readonly string[]> = {
    CART_ABANDONED: ["customer", "items", "total", "cartLink", "shop", "app"],
    PAYMENT_PENDING: ["customer", "billNo", "amount", "date", "link", "shop"],
    WELCOME: ["customer", "shop", "link", "app"],
};

export function emailFieldsFor(kind: EmailTemplateKind): readonly EmailField[] {
    if (isShared(kind)) return fieldsFor(kind);
    const keys = new Set(OWN_FIELDS[kind]);
    return EMAIL_FIELDS.filter((f) => keys.has(f.key));
}

const BASE_SAMPLES = Object.fromEntries(EMAIL_FIELDS.map((f) => [f.key, f.sample])) as Record<EmailFieldKey, string>;

export function emailSampleValues(kind: EmailTemplateKind): EmailFieldValues {
    if (isShared(kind)) return { ...BASE_SAMPLES, ...sampleValuesFor(kind) };
    if (kind === "PAYMENT_PENDING") return { ...BASE_SAMPLES, billNo: "#3108", link: `${SHOP_URL}/portal/orders` };
    if (kind === "WELCOME") return { ...BASE_SAMPLES, link: `${SHOP_URL}/portal` };
    return BASE_SAMPLES;
}

const FIELD_RE = /\{(\w+)\}/g;

/** `{customer}` → its value; an unknown field is left as typed. */
export function fillEmail(text: string, values: EmailFieldValues): string {
    return text.replace(FIELD_RE, (whole, k: string) => values[k as EmailFieldKey] ?? whole);
}

// ── Default wording ─────────────────────────────────────────────────────────

export type EmailTemplateDraft = { subject: string; body: string };

export const EMAIL_SUBJECT_MAX = 200;
export const EMAIL_BODY_MAX = 5000;

const SIGN_OFF = "\n\nThank you,\n{shop}";
const LINKS = "\n\nView it online: {link}\nGet our app: {app}";
const doc = (noLabel: string, amountLabel = "Amount") =>
    `${noLabel}: {billNo}\nDate: {date}\n${amountLabel}: Rs {amount}`;
const BALANCE = "\n\nPrevious balance: {prevBalance}\nBalance now: {balance}";

export const EMAIL_TEMPLATE_DEFAULTS: Record<EmailTemplateKind, EmailTemplateDraft> = {
    SALE: {
        subject: "Your bill {billNo} from {shop}",
        body: `Dear {customer},\n\nThank you for shopping with us. Here are your bill details.\n\n${doc("Bill no")}${BALANCE}${LINKS}${SIGN_OFF}`,
    },
    RECEIPT: {
        subject: "Payment received — {billNo}",
        body: `Dear {customer},\n\nWe have received your payment. Thank you.\n\n${doc("Receipt no", "Amount received")}${BALANCE}${LINKS}${SIGN_OFF}`,
    },
    SALE_RETURN: {
        subject: "Credit note {billNo} from {shop}",
        body: `Dear {customer},\n\nYour return has been recorded.\n\n${doc("Credit note no")}${BALANCE}${LINKS}${SIGN_OFF}`,
    },
    REFUND: {
        subject: "Refund {billNo} from {shop}",
        body: `Dear {customer},\n\nWe have paid your refund.\n\n${doc("Refund no", "Amount paid")}${BALANCE}${LINKS}${SIGN_OFF}`,
    },
    ORDER: {
        subject: "Order {billNo} booked — {shop}",
        body: `Dear {customer},\n\nYour order has been booked. We will tell you when it is ready.\n\n${doc("Order no")}${LINKS}${SIGN_OFF}`,
    },
    ESTIMATE: {
        subject: "Estimate {billNo} from {shop}",
        body: `Dear {customer},\n\nHere is the estimate you asked for.\n\n${doc("Estimate no")}${LINKS}${SIGN_OFF}`,
    },
    REPAIR_RECEIVED: {
        subject: "We received your {device} — job {billNo}",
        body: `Dear {customer},\n\nWe have received your {device} for repair.\n\nJob no: {billNo}\nDate: {date}\n\nTrack your repair: {link}${SIGN_OFF}`,
    },
    REPAIR_READY: {
        subject: "Your {device} is ready — job {billNo}",
        body: `Dear {customer},\n\nGood news! Your {device} is repaired and ready for pickup.\n\nJob no: {billNo}\n\nDetails: {link}${SIGN_OFF}`,
    },
    DUE_SOFT: {
        subject: "A gentle reminder from {shop}",
        body: `Dear {customer},\n\nThis is a friendly reminder that Rs {amount} is pending on your account (since {date}).\n\nSee your bills and pay by UPI: {link}\n\nPlease ignore this if you have already paid.${SIGN_OFF}`,
    },
    DUE_FIRM: {
        subject: "Payment due: Rs {amount} — {shop}",
        body: `Dear {customer},\n\nRs {amount} has been due on your account since {date}. Please clear it at the earliest.\n\nSee your bills and pay by UPI: {link}${SIGN_OFF}`,
    },
    CART_ABANDONED: {
        subject: "You left something in your cart",
        body: `Dear {customer},\n\nYou left these items in your cart:\n\n{items}\n\nTotal: about Rs {total}\n\nComplete your order: {cartLink}\n\nPrices and stock can change, so order soon.${SIGN_OFF}`,
    },
    PAYMENT_PENDING: {
        subject: "Complete the payment for order {billNo}",
        body: `Dear {customer},\n\nYour order {billNo} (Rs {amount}, placed on {date}) is waiting for payment.\n\nPay or check it here: {link}\n\nIf you have already paid, please ignore this email.${SIGN_OFF}`,
    },
    WELCOME: {
        subject: "Welcome to {shop}",
        body: `Dear {customer},\n\nWelcome! Your account is ready.\n\nSee your bills, payments, warranty and repair status anytime: {link}\nGet our app: {app}${SIGN_OFF}`,
    },
};

/** Problems with a draft — empty means fine. */
export function checkEmailDraft(draft: EmailTemplateDraft, kind: EmailTemplateKind): string[] {
    const errs: string[] = [];
    if (!draft.subject.trim()) errs.push("Subject is empty.");
    if (!draft.body.trim()) errs.push("Message is empty.");
    if (draft.subject.length > EMAIL_SUBJECT_MAX) errs.push(`Subject is longer than ${EMAIL_SUBJECT_MAX} characters.`);
    if (draft.body.length > EMAIL_BODY_MAX) errs.push(`Message is longer than ${EMAIL_BODY_MAX} characters.`);
    const allowed = new Set<string>(emailFieldsFor(kind).map((f) => f.key));
    const seen = new Set<string>();
    for (const m of `${draft.subject}\n${draft.body}`.matchAll(FIELD_RE)) {
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        if (!allowed.has(m[1])) errs.push(`{${m[1]}} is not a field for a ${EMAIL_TEMPLATE_LABEL[kind]} email — use the buttons to insert one.`);
    }
    return errs;
}

/** The line every marketing email ends with; `url` is the signed link. */
export function unsubscribeLine(url: string): string {
    return `\n\n—\nDon't want these emails? Unsubscribe: ${url}`;
}
export const UNSUBSCRIBE_SAMPLE_URL = `${SHOP_URL}/portal/unsubscribe?e=…`;

export const SHOP_CART_URL = `${SHOP_URL}/shop/cart`;
export const SHOP_APP_URL = `${SHOP_URL}${SHOP_APP_INSTALL}`;
export const PORTAL_URL = `${SHOP_URL}/portal`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain body → simple HTML: escaped, line breaks kept, links clickable. */
export function emailBodyToHtml(text: string): string {
    const html = esc(text)
        .replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`)
        .replace(/\n/g, "<br>");
    return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">${html}</div>`;
}
