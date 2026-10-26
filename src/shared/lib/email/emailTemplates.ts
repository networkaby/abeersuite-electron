/**
 * Email bill / receipt templates — the wording side, shared by the office
 * editor (live preview) and the server (sending).
 *
 * The email twin of whatsapp/billTemplates.ts and deliberately thin on top of
 * it: the same friendly fields ({customer}, {billNo}, …), the same sample
 * values and the same `fillBody`, so a field means one thing on both channels.
 * Unlike WhatsApp there is no approval step and no slot rules — the saved
 * subject + body are what goes out.
 */

import {
    WA_TEMPLATE_LABEL,
    WA_TEMPLATE_WHEN,
    fieldsFor,
    sampleValuesFor,
    type WaTemplateKind,
} from "@/shared/lib/whatsapp/billTemplates";

/** The voucher kinds an email can announce (repairs / tickets / dues later). */
export const EMAIL_TEMPLATE_KINDS = ["SALE", "RECEIPT", "SALE_RETURN", "REFUND", "ORDER", "ESTIMATE"] as const satisfies readonly WaTemplateKind[];
export type EmailTemplateKind = (typeof EMAIL_TEMPLATE_KINDS)[number];

export const EMAIL_TEMPLATE_LABEL: Record<EmailTemplateKind, string> = Object.fromEntries(
    EMAIL_TEMPLATE_KINDS.map((k) => [k, WA_TEMPLATE_LABEL[k]]),
) as Record<EmailTemplateKind, string>;

export const EMAIL_TEMPLATE_WHEN: Record<EmailTemplateKind, string> = {
    ...(Object.fromEntries(EMAIL_TEMPLATE_KINDS.map((k) => [k, WA_TEMPLATE_WHEN[k]])) as Record<EmailTemplateKind, string>),
    // WhatsApp's wording points at its 3-dot send; email has none yet.
    ESTIMATE: "Estimate saved (POS or office). Auto send starts off.",
};

export function isEmailKind(kind: string): kind is EmailTemplateKind {
    return (EMAIL_TEMPLATE_KINDS as readonly string[]).includes(kind);
}

/** UniversalVoucher type → the email kind that announces it, or null. */
/** Estimates start off, as on WhatsApp — staff make rough quotes. */
export function emailAutoSendDefault(kind: EmailTemplateKind): boolean {
    return kind !== "ESTIMATE";
}

export const emailFieldsFor = (kind: EmailTemplateKind) => fieldsFor(kind);
export const emailSampleValues = (kind: EmailTemplateKind) => sampleValuesFor(kind);

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
};

const FIELD_RE = /\{(\w+)\}/g;

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

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain body → simple HTML: escaped, line breaks kept, links clickable. */
export function emailBodyToHtml(text: string): string {
    const html = esc(text)
        .replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`)
        .replace(/\n/g, "<br>");
    return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">${html}</div>`;
}
