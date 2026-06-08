// Pure builders for sharing a "please pay ₹X" link + QR with a customer. No DB,
// no React — safe to import from client components. Deliberately extensible: each
// rail is a PaymentLinkProvider, so a hosted Razorpay link (or any other) drops in
// later by appending to PAYMENT_LINK_PROVIDERS — the POS dialog renders whatever is
// `available`.

import { COMPANY_DETAILS } from "@/utils/constants-company-details";

export type PaymentLinkArgs = {
    /** Amount to collect, in rupees. */
    amountRupees: number;
    /** Short transaction note (e.g. bill ref / customer name). */
    note: string;
};

export type PaymentLinkProvider = {
    id: string;
    label: string;
    /** Short hint shown under the picker (or the reason it's unavailable). */
    hint: string;
    /** False → the rail isn't configured/built yet; the UI disables it. */
    available: boolean;
    /** Build the shareable link string (a `upi://`, `https://`, …) for an amount. */
    build(args: PaymentLinkArgs): string;
};

const fmtINR = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/// UPI deep link to the business's own VPA. Opens any UPI app pre-filled with the
/// payee + amount; the same string also encodes cleanly into a scannable QR.
/// Spec: upi://pay?pa=<vpa>&pn=<payee>&am=<amount>&cu=INR&tn=<note>
export const upiProvider: PaymentLinkProvider = {
    id: "upi",
    label: "UPI",
    get hint() {
        return COMPANY_DETAILS.upi.vpa
            ? `Pays into ${COMPANY_DETAILS.upi.vpa}`
            : "Set your business UPI ID in company settings to enable this.";
    },
    get available() {
        return !!COMPANY_DETAILS.upi.vpa;
    },
    build({ amountRupees, note }: PaymentLinkArgs): string {
        const { vpa, payeeName } = COMPANY_DETAILS.upi;
        const params = new URLSearchParams({
            pa: vpa,
            pn: payeeName,
            am: amountRupees.toFixed(2),
            cu: "INR",
        });
        if (note) params.set("tn", note);
        // URLSearchParams encodes spaces as "+"; UPI apps want %20 — normalise.
        return `upi://pay?${params.toString().replace(/\+/g, "%20")}`;
    },
};

/// All known rails, in display order. Append new providers here (e.g. a hosted
/// Razorpay payment link once the backend exists) — no UI change needed.
export const PAYMENT_LINK_PROVIDERS: PaymentLinkProvider[] = [upiProvider];

/// Human-readable WhatsApp/SMS body ending with the payment link.
export function paymentLinkMessage(opts: {
    partyName?: string | null;
    amountRupees: number;
    link: string;
    billRef?: string | null;
}): string {
    const { partyName, amountRupees, link, billRef } = opts;
    const lines = [
        `Hello${partyName ? ` ${partyName}` : ""},`,
        ``,
        `Please pay ${fmtINR(amountRupees)}${billRef ? ` for ${billRef}` : ""}.`,
        ``,
        `Tap to pay:`,
        link,
        ``,
        `Thank you — ${COMPANY_DETAILS.upi.payeeName || COMPANY_DETAILS.brandName}`,
    ];
    return lines.join("\n");
}

/// WhatsApp Web compose link (web.whatsapp.com) with the message prefilled.
/// WhatsApp has no API to attach media via a link, so only the text/link travels —
/// the QR is shown on-screen for an in-person scan. Mirrors the gift-card pattern.
export function whatsappWebShareUrl(phone: string | null | undefined, text: string): string {
    const num = (phone ?? "").replace(/\D/g, "");
    const base = num ? `https://web.whatsapp.com/send?phone=${num}&text=` : "https://web.whatsapp.com/send?text=";
    return base + encodeURIComponent(text);
}
