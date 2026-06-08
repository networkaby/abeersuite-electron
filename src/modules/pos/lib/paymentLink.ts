// Pure builders for sharing a "please pay ₹X" link + QR with a customer. No DB,
// no React — safe to import from client components. Deliberately extensible: each
// rail is a PaymentLinkProvider, so a hosted Razorpay link (or any other) drops in
// later by appending to PAYMENT_LINK_PROVIDERS — the POS dialog renders whatever is
// `available`.
//
// The UPI identity (VPA) is PER-COUNTER, not global: it's passed in via
// PaymentContext from the active counter (PosCounter.upiVpa, set under
// /office/admin/counters). The payee *name* shown in the customer's UPI app stays
// company-level (COMPANY_DETAILS.upi.payeeName).

import { COMPANY_DETAILS } from "@/utils/constants-company-details";

/// Runtime payment identity for the active counter.
export type PaymentContext = {
    /** This counter's UPI VPA, or null/empty when the counter has none set. */
    upiVpa: string | null;
    /** Payee name shown in the UPI app (company-level). */
    payeeName: string;
};

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
    hint(ctx: PaymentContext): string;
    /** False → the rail isn't configured/built yet; the UI disables it. */
    available(ctx: PaymentContext): boolean;
    /** Build the shareable link string (a `upi://`, `https://`, …) for an amount. */
    build(ctx: PaymentContext, args: PaymentLinkArgs): string;
};

const fmtINR = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/// UPI deep link to this counter's own VPA. Opens any UPI app pre-filled with the
/// payee + amount; the same string also encodes cleanly into a scannable QR.
/// Spec: upi://pay?pa=<vpa>&pn=<payee>&am=<amount>&cu=INR&tn=<note>
export const upiProvider: PaymentLinkProvider = {
    id: "upi",
    label: "UPI",
    hint(ctx) {
        return ctx.upiVpa
            ? `Pays into ${ctx.upiVpa}`
            : "This counter has no UPI ID set. Add one under Settings → Counters.";
    },
    available(ctx) {
        return !!ctx.upiVpa?.trim();
    },
    build(ctx, { amountRupees, note }) {
        const params = new URLSearchParams({
            pa: (ctx.upiVpa ?? "").trim(),
            pn: ctx.payeeName,
            am: amountRupees.toFixed(2),
            cu: "INR",
        });
        if (note) params.set("tn", note);
        // URLSearchParams encodes spaces as "+"; UPI apps want %20 — normalise.
        return `upi://pay?${params.toString().replace(/\+/g, "%20")}`;
    },
};

/// Hosted payment-gateway link (card / netbanking / UPI) — to be backed by
/// Cashfree, which creates a real payment-page URL server-side. Disabled until the
/// backend + keys exist; once built, `build()` returns the Cashfree `link_url` and
/// the share message carries that https link instead of the VPA.
export const cashfreeProvider: PaymentLinkProvider = {
    id: "cashfree",
    label: "Card / Gateway (Cashfree)",
    hint: () => "Card · netbanking · UPI payment link — coming soon (Cashfree).",
    available: () => false,
    build: () => {
        throw new Error("Cashfree gateway not configured yet");
    },
};

/// All known rails, in display order. The UPI rail works today; Cashfree is the
/// next provider (hosted gateway link). Append more here — no UI change needed.
export const PAYMENT_LINK_PROVIDERS: PaymentLinkProvider[] = [upiProvider, cashfreeProvider];

/// Company-level payee name shown in the customer's UPI app (the VPA itself is
/// per-counter and supplied separately).
export const DEFAULT_PAYEE_NAME = COMPANY_DETAILS.upi.payeeName || COMPANY_DETAILS.brandName;

/// Human-readable WhatsApp/SMS body. Carries the plain UPI ID (VPA) — clean to read
/// and pay to — plus a nudge to scan the attached QR (which encodes the amount).
/// When the Cashfree gateway lands, pass its https link as `payTo` instead.
export function paymentLinkMessage(opts: {
    partyName?: string | null;
    amountRupees: number;
    payTo: string;
    payToLabel?: string;
    billRef?: string | null;
}): string {
    const { partyName, amountRupees, payTo, payToLabel = "UPI ID", billRef } = opts;
    const lines = [
        `Hello${partyName ? ` ${partyName}` : ""},`,
        ``,
        `Please pay ${fmtINR(amountRupees)}${billRef ? ` for ${billRef}` : ""}.`,
        ``,
        `${payToLabel}: ${payTo}`,
        `(or scan the QR I've shared)`,
        ``,
        `Thank you — ${DEFAULT_PAYEE_NAME}`,
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
