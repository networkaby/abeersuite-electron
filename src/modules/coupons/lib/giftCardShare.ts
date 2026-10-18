// Pure builders for sharing a gift card over WhatsApp / email. No DB, no React —
// safe to import from client components. The repo has no email/WhatsApp backend,
// so we share via wa.me + mailto deep links (one tap opens the user's app with the
// message prefilled), matching the existing sharing pattern elsewhere in the app.

import { formatInrLoose } from "@/shared/lib/format/moneyInr";

export interface GiftCardShareInfo {
    brandName: string;
    code: string;
    balance: number;
    expiresAt?: string | null;
    /// Absolute or relative link to the printable/viewable card (optional).
    link?: string;
}

const fmtINR = formatInrLoose;

/// The shared human-readable message body used by both channels.
export function giftCardMessage(info: GiftCardShareInfo): string {
    const lines = [
        `🎁 Here's your ${info.brandName} gift card!`,
        ``,
        `Value: ${fmtINR(info.balance)}`,
        `Code: ${info.code}`,
    ];
    if (info.expiresAt) lines.push(`Valid until: ${info.expiresAt.slice(0, 10)}`);
    lines.push(``, `Show this code at checkout to redeem.`);
    if (info.link) lines.push(``, info.link);
    return lines.join("\n");
}

/// wa.me deep link. Pass the recipient's phone (any format) to target a chat;
/// omit it to let WhatsApp show the contact picker.
export function giftCardWhatsappUrl(info: GiftCardShareInfo, phone?: string | null): string {
    const num = (phone ?? "").replace(/\D/g, "");
    return `https://wa.me/${num}?text=${encodeURIComponent(giftCardMessage(info))}`;
}

/// WhatsApp Web compose link (web.whatsapp.com) with the message prefilled.
/// WhatsApp has no API to attach media via a link, so the image is delivered
/// separately (clipboard paste / download) — this just carries the text.
export function giftCardWhatsappWebUrl(info: GiftCardShareInfo, phone?: string | null): string {
    const num = (phone ?? "").replace(/\D/g, "");
    const base = num ? `https://web.whatsapp.com/send?phone=${num}&text=` : "https://web.whatsapp.com/send?text=";
    return base + encodeURIComponent(giftCardMessage(info));
}

/// mailto deep link. Pass the recipient's email to prefill the To: field.
export function giftCardEmailUrl(info: GiftCardShareInfo, email?: string | null): string {
    const to = (email ?? "").trim();
    const subject = encodeURIComponent(`Your ${info.brandName} gift card`);
    const body = encodeURIComponent(giftCardMessage(info));
    return `mailto:${to}?subject=${subject}&body=${body}`;
}
