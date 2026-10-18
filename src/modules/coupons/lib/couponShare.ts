// Pure builders for sharing a COUPON over WhatsApp / email — mirrors
// giftCardShare. No DB, no React (client-safe). WhatsApp/email have no media-via-
// link API, so the image is delivered separately (clipboard / share sheet); these
// just carry the text. Only coupons WITH a code are shareable.

import { formatInrLoose } from "@/shared/lib/format/moneyInr";

export interface CouponShareInfo {
    brandName: string;
    code: string;
    name: string;
    /// Human value, e.g. "20% off (max ₹500)" or "₹500 off".
    value: string;
    minBill?: number | null;
    validUntil?: string | null;
}

const fmtINR = formatInrLoose;

// Numeric mechanic fields shared by the message, the image, and the print card.
// Values are `unknown` so this stays Prisma-free yet accepts a Prisma Decimal
// (from server routes), a plain number/string (from the client), or null —
// Number() coerces all three at runtime.
export interface CouponValueFields {
    type: "PERCENT" | "FLAT" | "FREE_ITEM" | "BOGO" | "SET_PRICE";
    percentOff?: unknown;
    maxDiscountAmt?: unknown;
    flatAmt?: unknown;
    buyQty?: unknown;
    getQty?: unknown;
    setPriceAmt?: unknown;
}
const num = (v: unknown) => Number(v ?? 0);

/// Big, punchy headline for the visual card/image, e.g. "20% OFF", "₹500 OFF".
export function couponHeadline(c: CouponValueFields): string {
    switch (c.type) {
        case "PERCENT": return `${num(c.percentOff)}% OFF`;
        case "FLAT":    return `${fmtINR(num(c.flatAmt))} OFF`;
        case "FREE_ITEM": return "FREE ITEM";
        case "BOGO":    return `BUY ${num(c.buyQty)} GET ${num(c.getQty)}`;
        case "SET_PRICE": return `${fmtINR(num(c.setPriceAmt))} EACH`;
    }
}

/// One-line sentence for the share text, e.g. "20% off (max ₹500)".
export function couponValueText(c: CouponValueFields): string {
    switch (c.type) {
        case "PERCENT": return `${num(c.percentOff)}% off${c.maxDiscountAmt != null ? ` (max ${fmtINR(num(c.maxDiscountAmt))})` : ""}`;
        case "FLAT":    return `${fmtINR(num(c.flatAmt))} off the bill`;
        case "FREE_ITEM": return "Free / discounted item";
        case "BOGO":    return `Buy ${num(c.buyQty)} get ${num(c.getQty)}`;
        case "SET_PRICE": return `${fmtINR(num(c.setPriceAmt))} each`;
    }
}

/// The shared human-readable message body used by every channel.
export function couponMessage(info: CouponShareInfo): string {
    const lines = [
        `🎟️ ${info.brandName} coupon — ${info.name}`,
        ``,
        info.value,
        `Code: ${info.code}`,
    ];
    if (info.minBill && info.minBill > 0) lines.push(`Min bill: ${fmtINR(info.minBill)}`);
    if (info.validUntil) lines.push(`Valid until: ${info.validUntil.slice(0, 10)}`);
    lines.push(``, `Use this code at checkout.`);
    return lines.join("\n");
}

/// wa.me deep link (opens app on mobile, WhatsApp Web/desktop on desktop).
export function couponWhatsappUrl(info: CouponShareInfo, phone?: string | null): string {
    const num = (phone ?? "").replace(/\D/g, "");
    return `https://wa.me/${num}?text=${encodeURIComponent(couponMessage(info))}`;
}

/// WhatsApp Web compose link with the message prefilled (image pasted separately).
export function couponWhatsappWebUrl(info: CouponShareInfo, phone?: string | null): string {
    const num = (phone ?? "").replace(/\D/g, "");
    const base = num ? `https://web.whatsapp.com/send?phone=${num}&text=` : "https://web.whatsapp.com/send?text=";
    return base + encodeURIComponent(couponMessage(info));
}

/// mailto deep link.
export function couponEmailUrl(info: CouponShareInfo, email?: string | null): string {
    const to = (email ?? "").trim();
    const subject = encodeURIComponent(`${info.brandName} coupon — ${info.name}`);
    const body = encodeURIComponent(couponMessage(info));
    return `mailto:${to}?subject=${subject}&body=${body}`;
}
